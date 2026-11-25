"""Watch my area (app/watch.py).

  • ``POST   /api/watches``                    — ``{"bbox": [...], "name"?}`` → the new watch (201)
  • ``GET    /api/watches/<id>``               — the watch: passes, candidates, log, status
  • ``POST   /api/watches/<id>/check``         — check now (if no check is running)
  • ``DELETE /api/watches/<id>``               — stop watching and delete everything
  • ``GET    /api/watches/<id>/feed.atom``     — Atom feed of what happened
  • ``GET    /api/watches/<id>/files/<path>``  — a pass's image

Opening a watch or its feed starts a check when the last one is older than
``watch.REFRESH_HOURS``.
"""
from __future__ import annotations

import os

from flask import Blueprint, Response, abort, jsonify, request, send_file

from app import limiter, watch

watch_blueprint = Blueprint('watch', __name__)


def _page_url(wid: str) -> str:
    # Feed readers send no Origin: prefer the configured frontend, then the first CORS origin.
    allowed = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    base = (os.getenv("PUBLIC_APP_URL") or (allowed[0] if allowed else None)
            or request.headers.get("Origin") or request.host_url).rstrip("/")
    return f"{base}/watch/{wid}"


def _get(wid: str) -> dict:
    w = watch.load(wid)
    if w is None:
        abort(404, description='watch not found')
    return w


@watch_blueprint.route('/watches', methods=['POST'])
@limiter.limit("10 per hour")
def create_watch():
    body = request.get_json(silent=True) or {}
    try:
        w = watch.create(body.get('bbox'), body.get('name'))
    except watch.WatchError as exc:
        return jsonify({'error': str(exc)}), exc.status
    return jsonify(w), 201


@watch_blueprint.route('/watches/<wid>')
@limiter.limit("120 per minute")
def get_watch(wid):
    w = _get(wid)
    return jsonify(watch.public(w, watch.refresh_if_due(wid, w)))


@watch_blueprint.route('/watches/<wid>/check', methods=['POST'])
@limiter.limit("6 per hour")
def check_watch(wid):
    _get(wid)
    return jsonify(watch.start_check(wid)), 202


@watch_blueprint.route('/watches/<wid>', methods=['DELETE'])
@limiter.limit("30 per minute")
def delete_watch(wid):
    if not watch.delete(wid):
        abort(404, description='watch not found')
    return '', 204


@watch_blueprint.route('/watches/<wid>/feed.atom')
@limiter.limit("60 per minute")
def watch_feed(wid):
    w = _get(wid)
    watch.refresh_if_due(wid, w)
    xml = watch.atom(w, _page_url(wid), request.url)
    return Response(xml, mimetype='application/atom+xml')


@watch_blueprint.route('/watches/<wid>/files/<path:rel>')
@limiter.limit("600 per minute")
def watch_file(wid, rel):
    path = watch.file_path(wid, rel)
    if path is None:
        abort(404)
    response = send_file(path, max_age=86400)
    response.headers['Cache-Control'] = 'public, max-age=86400, immutable'
    return response
