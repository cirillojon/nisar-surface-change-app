"""Stories, findings and coverage: what the workspace's three modes call.

  • ``GET /api/stories``                    — themes and the story list (``?theme=``)
  • ``GET /api/stories/<slug>``             — one story: question, moments, hypotheses, limits, next
  • ``GET /api/stories/<slug>/series.csv``  — every NISAR value at a study site, as CSV
  • ``GET /api/findings/<slug>``            — one moment as a finding card (``?moment=N``)
  • ``GET /api/coverage-check``             — can NISAR answer a question here? (``?bbox=&start=&end=``)

The same functions back the agent tools (``app/tools.py``) and so the MCP
server, so every surface returns the same thing.
"""
from __future__ import annotations

import logging

from flask import Blueprint, Response, jsonify, request

from app import limiter, stories
from app.validators import validate_bbox, validate_optional_date

logger = logging.getLogger(__name__)

stories_blueprint = Blueprint('stories', __name__)


def _error(exc, status=400):
    return jsonify({'error': str(exc)}), status


@stories_blueprint.route('/stories')
@limiter.limit("120 per minute")
def list_stories():
    return jsonify(stories.list_stories(request.args.get('theme') or None))


@stories_blueprint.route('/stories/<slug>')
@limiter.limit("120 per minute")
def get_story(slug):
    try:
        return jsonify(stories.get_story(slug))
    except stories.StoryError as exc:
        return _error(exc, 404)


@stories_blueprint.route('/stories/<slug>/series.csv')
@limiter.limit("60 per minute")
def story_series_csv(slug):
    try:
        text = stories.series_csv(slug)
    except stories.StoryError as exc:
        return _error(exc, 404)
    return Response(text, mimetype='text/csv', headers={
        'Content-Disposition': f'attachment; filename="nisar-{slug}.csv"',
    })


@stories_blueprint.route('/stories/<slug>/export.geojson')
@limiter.limit("60 per minute")
def story_geojson(slug):
    try:
        data = stories.story_geojson(slug)
    except stories.StoryError as exc:
        return _error(exc, 404)
    response = jsonify(data)
    response.mimetype = 'application/geo+json'
    response.headers['Content-Disposition'] = f'attachment; filename="nisar-{slug}.geojson"'
    return response


@stories_blueprint.route('/findings/<slug>')
@limiter.limit("120 per minute")
def get_finding(slug):
    moment = request.args.get('moment')
    try:
        return jsonify(stories.build_finding(slug, None if moment in (None, '') else moment))
    except stories.StoryError as exc:
        status = 404 if 'No story' in str(exc) else 400
        return _error(exc, status)


@stories_blueprint.route('/coverage-check')
@limiter.limit("20 per minute")
def coverage():
    try:
        bbox = validate_bbox(request.args.get('bbox'))
        start, end = stories.default_window(
            validate_optional_date(request.args.get('start'), 'start'),
            validate_optional_date(request.args.get('end'), 'end'),
        )
    except (ValueError, stories.StoryError) as exc:
        return _error(exc)
    return jsonify(stories.coverage_check(bbox, start, end))
