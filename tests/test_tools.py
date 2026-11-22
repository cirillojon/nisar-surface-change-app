"""Shared tool registry (/api/tools), the OpenAPI spec route, and the assistant."""
import json
from pathlib import Path

import pytest


@pytest.fixture()
def _ai_enabled(monkeypatch):
    monkeypatch.setenv("ENABLE_AI", "1")


@pytest.fixture()
def app(_ai_enabled, app):
    """The tool registry and assistant routes are off unless ENABLE_AI is set, so
    set it before the app is created."""
    return app


def test_list_tools_has_schemas(client):
    r = client.get("/api/tools")
    assert r.status_code == 200
    tools = r.get_json()["tools"]
    names = {t["name"] for t in tools}
    assert {"list_sites", "get_site_timeseries", "search_docs", "open_in_workspace"} <= names
    for t in tools:
        assert t["description"]
        assert t["input_schema"]["type"] == "object"


def test_list_sites_tool(client, seeded_site):
    r = client.post("/api/tools/list_sites", json={})
    assert r.status_code == 200
    sites = r.get_json()["result"]["sites"]
    assert sites[0]["slug"] == "test-subsidence"
    assert sites[0]["workspace_url"] == "/workspace?site=test-subsidence"


def test_timeseries_resolves_site_by_name(client, seeded_site):
    r = client.post("/api/tools/get_site_timeseries", json={"site": "test basin"})
    assert r.status_code == 200
    result = r.get_json()["result"]
    assert result["series"]["los_mm"][-1] == {"date": "2026-06-13", "value": -12.5}
    assert result["units"]["los_mm"] == "mm"


def test_unknown_site_lists_choices(client, seeded_site):
    r = client.post("/api/tools/get_site_timeseries", json={"site": "Atlantis"})
    assert r.status_code == 400
    assert "test-subsidence" in r.get_json()["error"]


def test_tool_argument_checks(client):
    assert client.post("/api/tools/list_sites", json={"bogus": 1}).status_code == 400
    assert client.post("/api/tools/get_site_timeseries", json={}).status_code == 400
    assert client.post("/api/tools/nope", json={}).status_code == 404


def test_open_in_workspace(client, seeded_site):
    r = client.post("/api/tools/open_in_workspace", json={"site": "test-subsidence", "date": "2026-06-13"})
    assert r.get_json()["result"]["url"] == "/workspace?site=test-subsidence&date=2026-06-13"


def test_search_docs_finds_pages(client):
    r = client.post("/api/tools/search_docs", json={"query": "polarization HV vegetation"})
    assert r.status_code == 200
    paths = [x["path"] for x in r.get_json()["result"]["results"]]
    assert "/docs/science/polarization" in paths


def test_openapi_served_and_valid(client):
    r = client.get("/api/openapi.json")
    assert r.status_code == 200
    spec = r.get_json()
    assert spec["openapi"].startswith("3.1")
    tags = {t["name"] for t in spec["tags"]}
    for path, item in spec["paths"].items():
        for op in item.values():
            assert op["operationId"]
            assert set(op["tags"]) <= tags, path


def test_openapi_covers_every_api_route(app):
    """Every /api route is described in the spec (keeps the docs honest)."""
    spec = json.loads((Path(app.root_path) / "openapi.json").read_text(encoding="utf-8"))
    documented = {p.replace("{", "<").replace("}", ">") for p in spec["paths"]}
    for rule in app.url_map.iter_rules():
        path = str(rule)
        if not path.startswith("/api/") or path.startswith("/api/nisar/sme2/images") or path == "/api/openapi.json":
            continue
        normalized = path.replace("<int:", "<").replace("<path:", "<")
        assert normalized in documented, f"{path} missing from app/openapi.json"


def test_assistant_disabled_without_key(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    assert client.get("/api/assistant/status").get_json() == {"enabled": False, "model": None}
    r = client.post("/api/assistant/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 503


def test_assistant_rejects_bad_history(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    r = client.post("/api/assistant/chat", json={"messages": [{"role": "assistant", "content": "hi"}]})
    assert r.status_code == 400


@pytest.mark.parametrize("args,problem", [
    ({"site": "x"}, None),
    ({}, "missing"),
    ({"site": 3}, "must be a string"),
    ({"site": "x", "metric": "nope"}, "one of"),
    ({"site": "x", "extra": 1}, "unknown"),
])
def test_assistant_validates_tool_input(args, problem):
    from app import assistant, tools

    schema = tools.TOOLS_BY_NAME["get_site_timeseries"].input_schema
    result = assistant._validate(schema, args)
    if problem is None:
        assert result is None
    else:
        assert problem in result


class _Block:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class _Event:
    def __init__(self, text):
        self.type = "content_block_delta"
        self.delta = _Block(type="text_delta", text=text)


class _Stream:
    def __init__(self, message, texts):
        self._message, self._texts = message, texts

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        return iter(_Event(t) for t in self._texts)

    def get_final_message(self):
        return self._message


def test_assistant_runs_tools_and_streams(client, seeded_site, monkeypatch):
    """Turn 1 calls open_in_workspace; turn 2 answers. Checks the SSE events."""
    import anthropic

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    calls = []
    turns = [
        _Stream(_Block(stop_reason="tool_use", content=[
            _Block(type="tool_use", id="t1", name="open_in_workspace", input={"site": "test-subsidence"}),
        ]), []),
        _Stream(_Block(stop_reason="end_turn", content=[_Block(type="text", text="Here it is.")]),
                ["Here ", "it is."]),
    ]

    class FakeMessages:
        def stream(self, **kwargs):
            calls.append(kwargs)
            return turns[len(calls) - 1]

    class FakeClient:
        def __init__(self, *a, **k):
            self.beta = _Block(messages=FakeMessages())

    monkeypatch.setattr(anthropic, "Anthropic", FakeClient)
    r = client.post("/api/assistant/chat", json={
        "messages": [{"role": "user", "content": "Show me the test basin"}],
        "context": {"page": {"path": "/docs"}},
    })
    assert r.status_code == 200
    events = [json.loads(line[5:]) for line in r.get_data(as_text=True).splitlines() if line.startswith("data:")]
    types = [e["type"] for e in events]
    assert types[0] == "tool" and types[-1] == "done"
    action = next(e for e in events if e["type"] == "action")
    assert action["url"] == "/workspace?site=test-subsidence"
    assert "".join(e["text"] for e in events if e["type"] == "text").strip() == "Here it is."
    # Second request carries the tool result back to the model.
    tool_result = calls[1]["messages"][-1]["content"][0]
    assert tool_result["type"] == "tool_result" and tool_result["tool_use_id"] == "t1"
    assert calls[0]["model"] and all(t.get("eager_input_streaming") for t in calls[0]["tools"])


def test_mcp_tools_on_and_assistant_off_by_default(monkeypatch):
    monkeypatch.delenv("ENABLE_AI", raising=False)
    monkeypatch.delenv("ENABLE_MCP", raising=False)
    from app import create_app

    client = create_app().test_client()
    assert client.get("/api/tools").status_code == 200
    assert client.get("/api/assistant/status").status_code == 404
    assert client.get("/api/openapi.json").status_code == 200


def test_mcp_tools_can_be_switched_off(monkeypatch):
    monkeypatch.delenv("ENABLE_AI", raising=False)
    monkeypatch.setenv("ENABLE_MCP", "0")
    from app import create_app

    client = create_app().test_client()
    assert client.get("/api/tools").status_code == 404
    assert client.post("/api/tools/list_sites", json={}).status_code == 404
    assert client.get("/api/assistant/status").status_code == 404


def test_story_tools(client):
    from app import loader

    loader.load(force=True)
    names = {t["name"] for t in client.get("/api/tools").get_json()["tools"]}
    assert {"list_stories", "get_story", "build_finding", "export_site_series", "coverage_check"} <= names

    r = client.post("/api/tools/get_story", json={"story": "Okavango"})
    assert r.status_code == 200
    assert r.get_json()["result"]["slug"] == "okavango-flood-pulse"

    r = client.post("/api/tools/build_finding", json={"story": "okavango", "moment": 0})
    assert r.get_json()["result"]["id"] == "okavango-flood-pulse/0"

    r = client.post("/api/tools/build_finding", json={"story": "zzz"})
    assert r.status_code == 400 and "No stories match" in r.get_json()["error"]

    r = client.post("/api/tools/export_site_series", json={"site": "Sylhet"})
    result = r.get_json()["result"]
    assert result["rows"] > 0 and result["csv"].startswith("site,date,metric")
