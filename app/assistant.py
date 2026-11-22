"""The platform's AI assistant: Claude with this app's own tools and docs.

``POST /api/assistant/chat`` (``app/routes/assistant.py``) streams a reply
as Server-Sent Events. Each request runs a manual tool-use loop: Claude
may call the shared tools (``app/tools.py``: site data, NASA catalog
search, rain, docs search, ...), we run them in-process and feed results
back, until it answers. Events sent to the browser:

* ``text``   – a piece of the answer (Markdown)
* ``tool``   – a tool call starting / finished (name, arguments, summary)
* ``action`` – a UI action the page can offer (open the workspace on a site)
* ``error``  – something failed; the message is safe to show
* ``done``   – the reply is complete

Configuration (``.env``): ``ANTHROPIC_API_KEY`` (required to enable it),
``ASSISTANT_MODEL`` (default ``claude-sonnet-5-5``), ``ASSISTANT_EFFORT``
(default ``medium``), ``ASSISTANT_DAILY_LIMIT`` (requests per day across all
users, default 500). Without a key the assistant reports itself disabled
and nothing else changes.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from datetime import date
from typing import Any, Iterator

from app import tools as tool_registry

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-sonnet-5-5"
MAX_TOOL_ROUNDS = 8
MAX_TOOL_RESULT_CHARS = 14000
MAX_HISTORY_MESSAGES = 24
MAX_MESSAGE_CHARS = 8000
FALLBACK_BETA = "server-side-fallback-2026-07-01"

SYSTEM_PROMPT = """You are the assistant for the NISAR Surface Change Explorer, an open-source platform that makes radar data from NISAR (the NASA–ISRO Synthetic Aperture Radar satellite) understandable to scientists, developers, resource managers, decision-makers, educators and the public.

What you help with:
- Explaining radar remote sensing from first principles: backscatter, roughness and the dielectric constant, polarization (HH, HV), L-band wavelength, decibels, interferometry and line-of-sight motion, soil moisture.
- Navigating NISAR products (GCOV backscatter, GUNW interferograms, GOFF offsets, GSLC complex imagery, SME2 soil moisture), the platform's study sites and land-change gallery.
- Pulling real numbers with your tools, and writing working API calls (curl, Python, JavaScript) against this platform's REST API or its MCP server.
- Using the map workspace.

How to work:
- Ground answers in your tools. Use search_docs for concepts and how-to questions and cite the page as a Markdown link to its path (for example [Polarization](/docs/science/polarization)). Use the data tools for any number you quote, and say which granules or passes it came from when relevant.
- Match the reader. If the question is plain-language, answer plainly first (an analogy helps), then offer the technical detail. If it is technical, be precise and include units.
- Be honest about limits: most NISAR granules here are PROVISIONAL; site records are about a year long or shorter; values are medians over a whole box; open water is a single threshold (HH below -18 dB), compared over the area every pass imaged, that misses wind-roughened water and flooded vegetation; displacement is line-of-sight and relative to a reference point. The platform deliberately tests no causes and gives no advice: rain and river flow are shown for comparison only. Radar from a small area says nothing about commodity prices or markets. You may describe how series line up in time, and offer physical hypotheses clearly labeled as hypotheses, but never state that one caused another, and never give investment, farming or groundwater advice.
- For "why did this change?" questions, start from get_story: its hypotheses already give a driver, mechanism, radar channel, what the record shows, an alternative and a test. Present them in that shape, labeled as hypotheses. Use build_finding when someone wants something to cite or share, and coverage_check when they ask whether NISAR can see their area (find_place first when they name a place rather than give coordinates).
- When a study site or pass would help the user see what you describe, call open_in_workspace so the page can offer a button that opens the map there.
- API base paths: REST endpoints are under /api, described by the OpenAPI spec at /api/openapi.json. Code examples should use the endpoint paths exactly as documented.
- Keep answers focused: short paragraphs, lists or tables where they help. Use Markdown. Do not invent endpoints, datasets, site names or numbers.

The user's current page and map selection, when known, come after this prompt in a <context> block. Use it to resolve "this", "here" or "what am I looking at"."""


class AssistantDisabled(RuntimeError):
    """No API key is configured."""


class DailyLimitReached(RuntimeError):
    pass


_usage_lock = threading.Lock()
_usage = {"day": None, "count": 0}


def config() -> dict:
    return {
        "enabled": bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN")),
        "model": os.getenv("ASSISTANT_MODEL", DEFAULT_MODEL),
        "effort": os.getenv("ASSISTANT_EFFORT", "medium"),
        "daily_limit": int(os.getenv("ASSISTANT_DAILY_LIMIT", "500")),
    }


def status() -> dict:
    cfg = config()
    return {"enabled": cfg["enabled"], "model": cfg["model"] if cfg["enabled"] else None}


def _count_request(limit: int) -> None:
    with _usage_lock:
        today = date.today().isoformat()
        if _usage["day"] != today:
            _usage.update(day=today, count=0)
        if _usage["count"] >= limit:
            raise DailyLimitReached("The assistant's daily limit is reached. Please try again tomorrow.")
        _usage["count"] += 1


def _tool_defs() -> list[dict]:
    return [
        {
            "name": t.name,
            "description": t.description,
            "input_schema": t.input_schema,
            # Streamed request with client tools: inputs stream as generated.
            # The server no longer validates them, so _validate() does.
            "eager_input_streaming": True,
        }
        for t in tool_registry.TOOLS
    ]


_JSON_TYPES = {
    "string": str, "number": (int, float), "integer": int,
    "array": list, "object": dict, "boolean": bool,
}


def _validate(schema: dict, args: Any) -> str | None:
    """A problem with ``args`` against a tool's (flat) JSON Schema, or None."""
    if not isinstance(args, dict):
        return "arguments must be an object"
    props = schema.get("properties", {})
    for key in schema.get("required", []):
        if key not in args:
            return f"missing required argument {key!r}"
    for key, value in args.items():
        spec = props.get(key)
        if spec is None:
            return f"unknown argument {key!r}"
        expected = _JSON_TYPES.get(spec.get("type"))
        if expected and not isinstance(value, expected) or (
            spec.get("type") in ("number", "integer") and isinstance(value, bool)
        ):
            return f"{key!r} must be a {spec.get('type')}"
        if "enum" in spec and value not in spec["enum"]:
            return f"{key!r} must be one of {spec['enum']}"
    return None


def _clean_history(messages: Any) -> list[dict]:
    if not isinstance(messages, list) or not messages:
        raise ValueError("messages must be a non-empty list")
    cleaned = []
    for m in messages[-MAX_HISTORY_MESSAGES:]:
        if not isinstance(m, dict) or m.get("role") not in ("user", "assistant"):
            raise ValueError("each message needs role 'user' or 'assistant'")
        content = m.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        cleaned.append({"role": m["role"], "content": content[:MAX_MESSAGE_CHARS]})
    while cleaned and cleaned[0]["role"] != "user":
        cleaned.pop(0)
    if not cleaned or cleaned[-1]["role"] != "user":
        raise ValueError("the last message must be from the user")
    return cleaned


def _context_block(context: Any) -> str:
    if not isinstance(context, dict):
        return "<context>none</context>"
    safe = json.dumps(context, ensure_ascii=False)[:3000]
    return f"<context>{safe}</context>"


def _summarize(name: str, result: Any) -> str:
    if isinstance(result, dict):
        for key in ("sites", "granules", "results", "instruments", "change_types", "products", "drivers"):
            if isinstance(result.get(key), list):
                return f"{len(result[key])} {key.replace('_', ' ')}"
        if "url" in result:
            return result["url"]
        if "state" in result:
            return f"profile {result['state']}"
    return "done"


def _run_tool(name: str, args: dict) -> tuple[str, Any, bool]:
    """(content for Claude, raw result, is_error)."""
    try:
        result = tool_registry.call_tool(name, args)
    except KeyError:
        return f"Unknown tool {name!r}.", None, True
    except tool_registry.ToolError as exc:
        return f"Error: {exc}", None, True
    except Exception:  # a tool bug must not end the conversation
        logger.exception("Assistant tool %s failed", name)
        return "Error: the tool failed unexpectedly.", None, True
    text = json.dumps(result, ensure_ascii=False, default=str)
    if len(text) > MAX_TOOL_RESULT_CHARS:
        text = text[:MAX_TOOL_RESULT_CHARS] + ' …"(truncated)"'
    return text, result, False


def chat(messages: Any, context: Any = None) -> Iterator[dict]:
    """Run one assistant turn; yields event dicts ({"type": ..., ...})."""
    import anthropic

    cfg = config()
    if not cfg["enabled"]:
        raise AssistantDisabled("The assistant is not configured on this server.")
    history = _clean_history(messages)
    _count_request(cfg["daily_limit"])

    client = anthropic.Anthropic()
    system = [
        # Stable prefix first so it caches across requests; per-request
        # context goes in a second block after the cache breakpoint.
        {"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": _context_block(context)},
    ]
    tools = _tool_defs()
    schemas = {t.name: t.input_schema for t in tool_registry.TOOLS}
    convo: list[dict] = list(history)
    json_retries = 0
    rounds = 0

    while True:
        try:
            with client.beta.messages.stream(
                model=cfg["model"],
                max_tokens=16000,
                system=system,
                tools=tools,
                messages=convo,
                output_config={"effort": cfg["effort"]},
                # A safety decline re-runs on a fallback model in the same call.
                betas=[FALLBACK_BETA],
                fallbacks="default",
            ) as stream:
                for event in stream:
                    if event.type == "content_block_delta" and event.delta.type == "text_delta":
                        yield {"type": "text", "text": event.delta.text}
                response = stream.get_final_message()
            json_retries = 0
        except ValueError:
            # Tool-input JSON the SDK could not parse at all; re-issue the turn.
            json_retries += 1
            if json_retries > 2:
                yield {"type": "error", "message": "The assistant produced an invalid tool call. Please try again."}
                return
            continue
        except anthropic.RateLimitError:
            yield {"type": "error", "message": "The assistant is busy right now. Please try again in a minute."}
            return
        except anthropic.APIStatusError as exc:
            logger.warning("Assistant API error %s: %s", exc.status_code, exc.message)
            yield {"type": "error", "message": "The assistant hit an error talking to the model. Please try again."}
            return
        except anthropic.APIConnectionError:
            yield {"type": "error", "message": "The assistant could not reach the model. Please try again."}
            return

        if response.stop_reason == "pause_turn":
            convo.append({"role": "assistant", "content": response.content})
            continue
        if response.stop_reason == "refusal":
            yield {"type": "error", "message": "The assistant can't help with that request."}
            return

        tool_uses = [b for b in response.content if b.type == "tool_use"]
        if not tool_uses:
            break
        if response.stop_reason == "max_tokens":
            yield {"type": "error", "message": "The reply was cut off. Try a narrower question."}
            return
        rounds += 1
        if rounds > MAX_TOOL_ROUNDS:
            yield {"type": "error", "message": "The assistant used too many steps. Try a narrower question."}
            return

        results = []
        for block in tool_uses:
            problem = _validate(schemas.get(block.name, {"properties": {}}), block.input)
            yield {"type": "tool", "phase": "start", "id": block.id, "name": block.name,
                   "input": block.input if isinstance(block.input, dict) else {}}
            if problem:
                results.append({"type": "tool_result", "tool_use_id": block.id, "is_error": True,
                                "content": json.dumps({"INVALID_JSON": json.dumps(block.input, default=str), "problem": problem})})
                yield {"type": "tool", "phase": "end", "id": block.id, "name": block.name, "ok": False, "summary": problem}
                continue
            content, raw, is_error = _run_tool(block.name, block.input)
            results.append({"type": "tool_result", "tool_use_id": block.id, "content": content,
                            **({"is_error": True} if is_error else {})})
            yield {"type": "tool", "phase": "end", "id": block.id, "name": block.name, "ok": not is_error,
                   "summary": content[:160] if is_error else _summarize(block.name, raw)}
            if block.name == "open_in_workspace" and not is_error and isinstance(raw, dict):
                label = block.input.get("site") or "the map"
                yield {"type": "action", "action": "open_workspace", "url": raw["url"],
                       "label": f"Open {label} in the workspace"}
        # Keep the assistant turn exactly as returned (thinking blocks included).
        convo.append({"role": "assistant", "content": response.content})
        convo.append({"role": "user", "content": results})
        yield {"type": "text", "text": "\n\n"}

    yield {"type": "done"}
