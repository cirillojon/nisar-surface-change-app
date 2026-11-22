"""Core API blueprint: health, change types and sites (all read-only).

  • ``GET /api/health``           — liveness + DB + loader status
  • ``GET /api/change-types``     — supported surface-change categories
  • ``GET /api/sites``            — list sites (``?change_type=``)
  • ``GET /api/sites/<id>``       — one site + its time series and scenes
  • ``GET /api/sites/<id>/chain`` — NISAR story: series, moments, related data
  • ``GET /api/area-context``     — rain at a drawn area over given dates
  • ``GET /api/geocode``          — find a place by name (OpenStreetMap)
  • ``GET /api/scenes/<image>``    — a scene image (``app/data/scenes/``)

NISAR catalog search lives in ``app/routes/nisar.py``.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

import requests
from flask import Blueprint, abort, jsonify, request, send_from_directory
from sqlalchemy import func

from app import auto, chains, db, drivers, geocode, limiter
from app.change_types import CHANGE_TYPES, change_type_list
from app.loader import SCENES_DIR
from app.models import LoadJob, Scene, Site
from app.validators import validate_bbox, validate_optional_date

logger = logging.getLogger(__name__)

api_blueprint = Blueprint('api', __name__)

_SITE_ROW_CAP = 500


@api_blueprint.route('/health')
@limiter.exempt
def health():
    """Liveness probe + DB connectivity + loader status."""
    try:
        db.session.execute(db.text('SELECT 1'))
        site_count = db.session.query(func.count(Site.id)).scalar() or 0

        sources = []
        last_success_at = None
        any_error = None
        try:
            for row in LoadJob.query.order_by(LoadJob.source_id).all():
                sources.append(row.to_dict())
                if row.last_success_at and (
                    last_success_at is None or row.last_success_at > last_success_at
                ):
                    last_success_at = row.last_success_at
                if row.last_error and not any_error:
                    any_error = row.last_error
        except Exception:
            logger.exception("Health: LoadJob query failed (table missing?)")

        return jsonify({
            'status': 'ok',
            'site_count': site_count,
            'last_load_at': (
                last_success_at.isoformat() if last_success_at else None
            ),
            'last_load_error': any_error,
            'sources': sources,
            'time': datetime.utcnow().isoformat(),
        })
    except Exception:
        logger.exception("Health check failed")
        return jsonify({'status': 'degraded'}), 503


@api_blueprint.route('/change-types')
@limiter.limit("120 per minute")
def list_change_types():
    return jsonify({'change_types': change_type_list()})


@api_blueprint.route('/sites')
@limiter.limit("60 per minute")
def list_sites():
    """List sites, alphabetically.

    Query params: ``change_type``, ``limit`` (default 200, max 500), ``offset``.
    """
    try:
        limit = min(max(int(request.args.get('limit', 200)), 1), _SITE_ROW_CAP)
        offset = max(int(request.args.get('offset', 0)), 0)
    except (TypeError, ValueError):
        return jsonify({'error': 'invalid limit/offset'}), 400

    q = Site.query
    change_type = request.args.get('change_type')
    if change_type:
        if change_type not in CHANGE_TYPES:
            return jsonify({'error': 'unknown change_type'}), 400
        q = q.filter(Site.change_type == change_type)

    total = q.count()
    rows = q.order_by(Site.name, Site.id).offset(offset).limit(limit).all()

    dates = {s.id: (0, None, None) for s in rows}
    for site_id, count, first, last in (
        db.session.query(
            Scene.site_id, func.count(Scene.id),
            func.min(Scene.acquired_on), func.max(Scene.acquired_on),
        )
        .filter(Scene.site_id.in_(list(dates)))
        .group_by(Scene.site_id)
    ):
        dates[site_id] = (count, first, last)
    # The newest pass's image per site, for the list's thumbnails.
    thumbs = {}
    for site_id, day, image in (
        db.session.query(Scene.site_id, Scene.acquired_on, Scene.image)
        .filter(Scene.site_id.in_(list(dates)), Scene.image.isnot(None))
        .order_by(Scene.acquired_on)
    ):
        thumbs[site_id] = image

    return jsonify({
        'sites': [s.to_dict(scene_dates=dates[s.id], thumb=thumbs.get(s.id)) for s in rows],
        'limit': limit,
        'offset': offset,
        'total': total,
    })


@api_blueprint.route('/sites/<int:site_id>')
@limiter.limit("120 per minute")
def get_site(site_id):
    site = db.session.get(Site, site_id)
    if site is None:
        abort(404)
    return jsonify({**site.to_dict(detail=True), 'story_metric': chains.story_metric(site.slug)})


@api_blueprint.route('/sites/<int:site_id>/chain')
@limiter.limit("120 per minute")
def get_site_chain(site_id):
    site = db.session.get(Site, site_id)
    if site is None:
        abort(404)
    return jsonify(chains.get_site_chain(site.to_dict(detail=True)))


def _area_and_dates():
    bbox = validate_bbox(request.args.get("bbox"))
    start = validate_optional_date(request.args.get("start"), "start")
    end = validate_optional_date(request.args.get("end"), "end")
    if start is None or end is None or start > end:
        raise ValueError("Provide a start date on or before the end date.")
    return bbox, start, end


@api_blueprint.route('/area-context')
@limiter.limit("30 per minute")
def get_area_context():
    try:
        bbox, start, end = _area_and_dates()
        return jsonify(chains.get_area_context(bbox, start, end))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except (requests.RequestException, drivers.SourceError):
        logger.warning("Area context: rain lookup failed", exc_info=True)
        return jsonify({"error": "Rainfall data is temporarily unavailable."}), 502


@api_blueprint.route('/geocode')
@limiter.limit("30 per minute")
def geocode_place():
    """Places matching ``?q=`` (OpenStreetMap Nominatim, cached)."""
    try:
        query = geocode.clean_query(request.args.get("q"))
        return jsonify({"query": query, "results": geocode.search(query), "attribution": geocode.ATTRIBUTION})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except requests.RequestException:
        logger.warning("Place search failed", exc_info=True)
        return jsonify({"error": "Place search is temporarily unavailable."}), 502


LANDCHANGE_PATH = SCENES_DIR.parent / 'landchange.json'


@api_blueprint.route('/landchange')
@limiter.limit("120 per minute")
def land_change():
    """Land-change gallery (``scripts/build_landchange.py`` output).

    Each pass gets ``image_url`` (what the map shows) and ``hh_url`` (8-bit
    HH dB layer the browser uses for change maps). Auto-detected places
    (``app/auto.py``) follow the curated ones with ``status: "auto"``. Sites marked ``hidden``
    (imagery for the guided tour) are left out of ``sites`` and returned by
    slug in ``imagery`` instead.
    """
    if not LANDCHANGE_PATH.is_file():
        return jsonify({'sites': [], 'generated_at': None})
    data = json.loads(LANDCHANGE_PATH.read_text(encoding='utf-8'))
    data.pop('_note', None)
    for site in data.get('sites', []):
        for p in site.get('passes', []):
            p['image_url'] = f"/api/scenes/{p['image']}"
            p['hh_url'] = f"/api/scenes/{p['hh']}"
    curated = {s['slug'] for s in data.get('sites', [])}
    for place in auto.gallery_places():
        if place['slug'] in curated:
            continue
        for p in place.get('passes', []):
            p['image_url'] = f"/api/scenes/{p['image']}"
            p['hh_url'] = f"/api/scenes/{p['hh']}"
        data['sites'].append(place)
    sites = data.get('sites', [])
    data['imagery'] = {s['slug']: s for s in sites if s.get('hidden')}
    data['sites'] = [s for s in sites if not s.get('hidden')]
    return jsonify(data)


@api_blueprint.route('/scenes/<path:image>')
@limiter.exempt
def scene_image(image):
    # send_from_directory rejects paths that escape SCENES_DIR.
    mimetype = 'image/webp' if image.endswith('.webp') else None
    return send_from_directory(SCENES_DIR, image, mimetype=mimetype, max_age=86400)

