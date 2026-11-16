"""Shared tool registry and API description over HTTP.

  • ``GET  /api/tools``         — every agent tool with its JSON Schema
  • ``POST /api/tools/<name>``  — call one tool with JSON arguments
  • ``GET  /api/openapi.json``  — the OpenAPI 3.1 description of this API

The MCP server (``mcp_server/``) is a thin client of the first two, and the
docs' "Try it" panels call them, so every surface runs the same code.

The tool routes are switched off unless ``ENABLE_AI=1`` (see
``app/__init__.py``); the OpenAPI description is always served.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from flask import Blueprint, Response, jsonify, request

from app import limiter
from app import tools as registry

logger = logging.getLogger(__name__)

tools_blueprint = Blueprint('tools', __name__)
openapi_blueprint = Blueprint('openapi', __name__)

OPENAPI_PATH = Path(__file__).resolve().parent.parent / 'openapi.json'


@tools_blueprint.route('/tools')
@limiter.limit("120 per minute")
def list_tools():
    return jsonify({'tools': [t.describe() for t in registry.TOOLS]})


@tools_blueprint.route('/tools/<name>', methods=['POST'])
@limiter.limit("60 per minute")
def call_tool(name):
    if name not in registry.TOOLS_BY_NAME:
        return jsonify({'error': f'unknown tool {name!r}'}), 404
    args = request.get_json(silent=True)
    if args is None:
        args = {}
    try:
        result = registry.call_tool(name, args)
    except registry.ToolError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception:
        logger.exception("Tool %s failed", name)
        return jsonify({'error': 'The tool failed unexpectedly.'}), 500
    return jsonify({'tool': name, 'result': result})


@openapi_blueprint.route('/openapi.json')
@limiter.exempt
def openapi():
    return Response(OPENAPI_PATH.read_text(encoding='utf-8'), mimetype='application/json')


def openapi_spec() -> dict:
    return json.loads(OPENAPI_PATH.read_text(encoding='utf-8'))
