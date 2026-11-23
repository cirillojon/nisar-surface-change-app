"""NISAR catalog endpoints (proxied NASA CMR search).

  • ``GET /api/nisar/products``      — the NISAR products we know how to search
  • ``GET /api/nisar/granules``      — granules over a bbox and date range
  • ``GET /api/nisar/coverage``      — how many granules of each product cover a bbox
  • ``GET /api/nisar/browse-bounds`` — exact map bounds of a granule's browse image
  • ``GET /api/nisar/sme2/scene``    — render an SME2 granule over a bbox
  • ``GET /api/nisar/sme2/images/<key>/<layer>.webp`` — a rendered SME2 image
  • ``GET /api/nisar/coverage-map``  — what the global coverage heatmap can show
  • ``GET /api/nisar/coverage-map/grid`` — one global coverage heatmap
  • ``GET /api/nisar/orbit``         — NISAR's computed ground track

The browser could call CMR directly, but going through the backend
keeps one place to cache, rate-limit and reshape results.
"""
from __future__ import annotations

import gzip
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

from flask import Blueprint, Response, abort, jsonify, request, send_file

from app import coverage_map, limiter, nisar, orbit, profiles, sme2
from app.validators import validate_bbox, validate_choice, validate_optional_date

nisar_blueprint = Blueprint('nisar', __name__)

_DEFAULT_LOOKBACK_DAYS = 90


def _json_maybe_gzip(payload, max_age=0):
    """JSON, gzipped when the client accepts it (these payloads are 100-300 KB)."""
    body = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    resp = Response(mimetype='application/json')
    if 'gzip' in request.headers.get('Accept-Encoding', ''):
        body = gzip.compress(body, compresslevel=6)
        resp.headers['Content-Encoding'] = 'gzip'
    resp.set_data(body)
    resp.headers['Vary'] = 'Accept-Encoding'
    if max_age:
        resp.headers['Cache-Control'] = f'public, max-age={max_age}'
    return resp


@nisar_blueprint.route('/products')
@limiter.limit("120 per minute")
def list_products():
    return jsonify({'products': nisar.product_list()})


@nisar_blueprint.route('/granules')
@limiter.limit("30 per minute")
def search_granules():
    """Query params:

      - ``bbox``    (required) ``min_lon,min_lat,max_lon,max_lat``
      - ``product`` ``GCOV`` (default) | ``GUNW`` | ``GOFF`` | ``GSLC`` | ``SME2``
      - ``start`` / ``end`` ``YYYY-MM-DD`` (default: last 90 days)
      - ``limit``   1–50 (default 20)
    """
    args = request.args
    try:
        if not args.get('bbox'):
            raise ValueError('bbox is required')
        bbox = validate_bbox(args['bbox'])
        product = validate_choice(args.get('product', 'GCOV'), 'product', nisar.PRODUCTS)
        end = validate_optional_date(args.get('end'), 'end') or date.today()
        start = (
            validate_optional_date(args.get('start'), 'start')
            or end - timedelta(days=_DEFAULT_LOOKBACK_DAYS)
        )
        if start > end:
            raise ValueError('start must be on or before end')
        try:
            limit = int(args.get('limit', 20))
        except ValueError:
            raise ValueError('limit must be an integer') from None
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    try:
        result = nisar.search_granules(bbox, start, end, product=product, limit=limit)
    except nisar.NisarSearchError as exc:
        return jsonify({'error': str(exc)}), 502

    return jsonify({**result, 'start': start.isoformat(), 'end': end.isoformat()})


def _hits(bbox, start, end, product):
    """Granules of ``product`` over the box, or None if the search failed."""
    try:
        return nisar.search_granules(bbox, start, end, product=product, limit=1)['hits']
    except nisar.NisarSearchError:
        return None


@nisar_blueprint.route('/coverage')
@limiter.limit("30 per minute")
def coverage():
    """How many granules of each product cover a box, so the UI can offer
    only the products that have data there.

    Query params: ``bbox`` (required) and ``start`` / ``end`` as for
    ``/granules``. ``products`` maps each product to its count, or ``null``
    if its search failed.
    """
    args = request.args
    try:
        if not args.get('bbox'):
            raise ValueError('bbox is required')
        bbox = validate_bbox(args['bbox'])
        end = validate_optional_date(args.get('end'), 'end') or date.today()
        start = (
            validate_optional_date(args.get('start'), 'start')
            or end - timedelta(days=_DEFAULT_LOOKBACK_DAYS)
        )
        if start > end:
            raise ValueError('start must be on or before end')
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    names = list(nisar.PRODUCTS)
    with ThreadPoolExecutor(max_workers=len(names)) as pool:
        counts = list(pool.map(lambda name: _hits(bbox, start, end, name), names))
    return jsonify({
        'products': dict(zip(names, counts)),
        'start': start.isoformat(),
        'end': end.isoformat(),
    })


@nisar_blueprint.route('/browse-bounds')
# One call per track/frame shown; a state-sized area has ~75 frames.
# Results are cached per frame, so repeats are cheap.
@limiter.limit("600 per minute")
def browse_bounds():
    """``?kml=`` a granule's ``browse_kml_url`` → ``{"bbox": [...]}``."""
    try:
        bbox = nisar.browse_bounds(request.args.get('kml', ''))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except nisar.NisarSearchError as exc:
        return jsonify({'error': str(exc)}), 502
    return jsonify({'bbox': bbox})


@nisar_blueprint.route('/sme2/scene')
@limiter.limit("600 per minute")
def sme2_scene():
    """``?granule=<SME2 granule name>&bbox=min_lon,min_lat,max_lon,max_lat``.

    Returns the pass's date, quality, values over the bbox (``hh_db``,
    ``hv_db``, ``water_pct``, ``soil_moisture``), and whole-frame
    ``images`` per layer (``backscatter``, ``soil_moisture``) with their
    ``image_bbox``. The first request for a granule renders its frame
    (~10 s); after that any area is instant.
    """
    try:
        title = sme2.validate_title(request.args.get('granule', ''))
        if not request.args.get('bbox'):
            raise ValueError('bbox is required')
        bbox = sme2.validate_area(validate_bbox(request.args['bbox']))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    try:
        return jsonify(sme2.get_scene(title, bbox))
    except sme2.Sme2Error as exc:
        return jsonify({'error': str(exc)}), exc.status
    except nisar.NisarSearchError as exc:
        return jsonify({'error': str(exc)}), 502


@nisar_blueprint.route('/profiles', methods=['POST'])
@limiter.limit("20 per minute")
def start_profile():
    """Body ``{"line": [[lon, lat], ...]}`` → ``{"id", "state"}``.

    Starts (or finds) the background job measuring height change along the
    line over NISAR's full record; poll ``GET /profiles/<id>``.
    """
    body = request.get_json(silent=True) or {}
    try:
        status = profiles.start(body.get('line'))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except profiles.ProfileError as exc:
        return jsonify({'error': str(exc)}), exc.status
    return jsonify(status), 202 if status['state'] != 'done' else 200


@nisar_blueprint.route('/profiles/<pid>')
@limiter.limit("240 per minute")
def get_profile(pid):
    """Job status (``queued`` | ``running`` | ``done`` | ``error``) and, when done, ``result``."""
    status = profiles.get(pid)
    if status is None:
        abort(404, description='profile not found')
    return jsonify(status)


@nisar_blueprint.route('/coverage-map')
@limiter.limit("120 per minute")
def coverage_map_info():
    """Products, metrics and months the coverage heatmap can show."""
    try:
        return jsonify(coverage_map.info())
    except coverage_map.CoverageMapUnavailable as exc:
        return jsonify({'error': str(exc)}), 503


@nisar_blueprint.route('/coverage-map/grid')
# A slider steps through months, one request each.
@limiter.limit("600 per minute")
def coverage_map_grid():
    """Query params: ``product`` (default GCOV), ``metric`` (default passes),
    ``month`` ``YYYY-MM`` (default: the latest), ``window`` ``month`` |
    ``cumulative``. Returns the grid packed as base64 uint16 (see
    ``app/coverage_map.py``).
    """
    args = request.args
    try:
        result = coverage_map.grid(
            args.get('product', 'GCOV'),
            args.get('metric', 'passes'),
            month=args.get('month') or None,
            window=args.get('window', 'month'),
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except coverage_map.CoverageMapUnavailable as exc:
        return jsonify({'error': str(exc)}), 503
    return _json_maybe_gzip(result, max_age=3600)


def _utc_param(value, field):
    try:
        parsed = datetime.fromisoformat(value.strip().replace('Z', '+00:00'))
    except (AttributeError, ValueError):
        raise ValueError(f'{field} must be an ISO 8601 time, e.g. 2026-11-22T12:00:00Z') from None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


@nisar_blueprint.route('/orbit')
@limiter.limit("60 per minute")
def orbit_track():
    """NISAR's sub-satellite point over a window, computed from its latest TLE.

    Query params: ``start`` / ``end`` ISO 8601 times (UTC if no offset;
    default: the 12 hours either side of now; at most 7 days apart, within
    14 days of the elements' epoch) and ``step`` seconds (10-600, default 60).
    """
    args = request.args
    try:
        now = datetime.now(timezone.utc).replace(microsecond=0)
        start = _utc_param(args['start'], 'start') if args.get('start') else now - timedelta(hours=12)
        end = _utc_param(args['end'], 'end') if args.get('end') else start + timedelta(hours=24)
        try:
            step = int(args.get('step', 60))
        except ValueError:
            raise ValueError('step must be an integer number of seconds') from None
        result = orbit.ground_track(start, end, step)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except orbit.OrbitError as exc:
        return jsonify({'error': str(exc)}), exc.status
    return _json_maybe_gzip(result, max_age=300)


@nisar_blueprint.route('/sme2/images/<key>/<layer>.webp')
@limiter.limit("600 per minute")
def sme2_image(key, layer):
    path = sme2.image_path(key, layer)
    if path is None:
        abort(404, description='image not found')
    return send_file(path, mimetype='image/webp', max_age=86400)
