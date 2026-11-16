"""AI assistant endpoints.

  • ``GET  /api/assistant/status`` — is the assistant configured, which model
  • ``POST /api/assistant/chat``   — stream a reply as Server-Sent Events

See ``app/assistant.py`` for the events and configuration.
"""
from __future__ import annotations

import json
import logging

from flask import Blueprint, Response, jsonify, request, stream_with_context

from app import assistant, limiter

logger = logging.getLogger(__name__)

assistant_blueprint = Blueprint('assistant', __name__)


@assistant_blueprint.route('/status')
@limiter.limit("120 per minute")
def assistant_status():
    return jsonify(assistant.status())


def _sse(event: dict) -> str:
    return f"event: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"


@assistant_blueprint.route('/chat', methods=['POST'])
@limiter.limit("10 per minute")
def assistant_chat():
    body = request.get_json(silent=True) or {}
    if not assistant.config()["enabled"]:
        return jsonify({'error': 'The assistant is not configured on this server.'}), 503
    try:
        events = assistant.chat(body.get('messages'), body.get('context'))
        first = next(events)  # surface argument errors and the daily cap as HTTP errors
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except assistant.DailyLimitReached as exc:
        return jsonify({'error': str(exc)}), 429
    except StopIteration:
        first = {"type": "done"}

    def stream():
        yield _sse(first)
        try:
            for event in events:
                yield _sse(event)
        except Exception:
            logger.exception("Assistant stream failed")
            yield _sse({"type": "error", "message": "The assistant stopped unexpectedly."})

    return Response(
        stream_with_context(stream()),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )
