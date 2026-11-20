"""NISAR Surface Change Explorer: MCP server.

Gives any MCP client (Claude Code, Claude Desktop, Cursor, ...) the platform's
tools: stories with labelled hypotheses, shareable findings, CSV export, a
coverage check for any area, study-site time series, NASA catalog search,
rain for any area, soil moisture, height profiles, the land-change gallery
and docs search.

It is a thin client of a running backend: tools are listed from
``GET {NISAR_API_URL}/api/tools`` and run with ``POST /api/tools/<name>``, so
it always offers exactly what the backend (and the docs) describe.

Run:
    python -m mcp_server                     # stdio (for local MCP clients)
    python -m mcp_server --http --port 8765  # streamable HTTP at /mcp

Environment:
    NISAR_API_URL   backend base URL (default http://localhost:8880)
"""
from __future__ import annotations

import argparse
import json
import os
from typing import Any

import anyio
import requests
from mcp import types
from mcp.server.lowlevel import Server

API_URL = os.getenv("NISAR_API_URL", "http://localhost:8880").rstrip("/")
TIMEOUT = float(os.getenv("NISAR_API_TIMEOUT", "120"))
USER_AGENT = "nisar-explorer-mcp/1.0"

INSTRUCTIONS = """Tools for NISAR (NASA–ISRO radar satellite) surface-change data.
Start with list_stories (curated places, each with a question and physical hypotheses) or
list_sites / list_land_change. get_story gives the five chapters (question, what NISAR measured,
hypotheses, what it can't see, future uses); build_finding turns one moment into a citable card;
export_site_series returns CSV. For a place named in words, find_place gives its coordinates and a
search_bbox. For a new area, coverage_check says which products have passes and how
often, then search_granules lists them. explain_site_change lines related series up in time (context,
not causes). search_docs explains the science. NISAR products are provisional.
Always present hypotheses as hypotheses, with their alternative and test; never state a cause as fact."""

PRIMER = """# Reading NISAR radar data: a primer

* **Backscatter (dB)**: how much radar energy returns. Higher = rougher or wetter surfaces,
  more vegetation volume, buildings. Calm open water is very dark (below about -18 dB HH).
* **HH vs HV**: HH (sent and received horizontally) responds to soil, stems and flooded
  vegetation (double bounce). HV (cross-polarized) rises with vegetation volume (crops, forest).
* **L-band (24 cm)**: NISAR's main wavelength reaches through canopy and is stable over
  vegetation, so it sees flooded forests and ground motion where shorter wavelengths fail.
* **Line-of-sight displacement (mm)**: motion toward (+) or away from (-) the satellite,
  relative to a reference point. Not purely vertical.
* **Soil moisture (m³/m³)**: volume of water per volume of soil; accuracy goal 0.06
  where vegetation is light.
* **On ice**: wet snow absorbs L-band and goes dark; dry snow and firn let it in, and
  HV rises with scattering inside them. HH shows the ice/water edge at a calving front.
  Glacier speed comes from pixel offsets (GOFF), not brightness.
* **On forest**: HV rises with woody volume but saturates over dense forest (roughly
  100 Mg/ha); clearing drops HV sharply. Water under trees makes HH brighter (double
  bounce), the opposite of open water.
* **Caveats**: most products are PROVISIONAL; site records span about a year; values are
  medians over a box; open water is compared over the area every pass imaged; rain and
  river flow are shown for comparison only, and the platform tests no causes.
"""

HYPOTHESIS_GUIDE = """# Writing a hypothesis about NISAR change

The platform never claims a cause. It offers hypotheses in a fixed shape, and so should you:

1. **Driver**: the physical process (e.g. "rain in Angola, months earlier").
2. **Mechanism**: how it changes the surface the radar sees.
3. **Channel**: which measurement responds and why (HH, HV, HH/HV, interferometric phase).
4. **Consistent with**: only what the record shows, with numbers and dates.
5. **Alternative**: another explanation that fits the same data (coverage, wind, atmosphere,
   soil moisture, a different crop...).
6. **Test**: the data that would tell them apart (gauges, GNSS, optical imagery, crop maps,
   a second year of passes).

Label it "Hypothesis: not tested here". Lining up in time is not evidence of cause; with a year
of passes, anything seasonal lines up with anything else seasonal.
"""

PROMPTS = {
    "tell_story": types.Prompt(
        name="tell_story",
        title="Tell a story",
        description="Walk through one story's five chapters with numbers, hypotheses and limits.",
        arguments=[types.PromptArgument(name="story", description="Story slug or title, e.g. Okavango", required=True)],
    ),
    "draft_finding": types.Prompt(
        name="draft_finding",
        title="Draft a one-page brief",
        description="Build a finding and write it up as a brief for a decision maker, with its limits.",
        arguments=[
            types.PromptArgument(name="story", description="Story slug or title", required=True),
            types.PromptArgument(name="moment", description="Moment index (optional)", required=False),
        ],
    ),
    "scout_area": types.Prompt(
        name="scout_area",
        title="Can NISAR answer my question here?",
        description="Run the coverage check over a box (or a named place) and say what NISAR could and couldn't support.",
        arguments=[
            types.PromptArgument(name="bbox", description="min_lon,min_lat,max_lon,max_lat, or a place name", required=True),
            types.PromptArgument(name="question", description="What you want to know", required=False),
        ],
    ),
    "investigate_site": types.Prompt(
        name="investigate_site",
        title="Investigate a study site",
        description="Pull a site's NISAR time series and impact chain and write a plain-language brief with caveats.",
        arguments=[types.PromptArgument(name="site", description="Site name or slug, e.g. Sylhet", required=True)],
    ),
    "check_my_area": types.Prompt(
        name="check_my_area",
        title="Check an area for change",
        description="Find NISAR passes over a bounding box, add rain context, and summarise what changed.",
        arguments=[
            types.PromptArgument(name="bbox", description="min_lon,min_lat,max_lon,max_lat", required=True),
            types.PromptArgument(name="start", description="YYYY-MM-DD", required=False),
            types.PromptArgument(name="end", description="YYYY-MM-DD", required=False),
        ],
    ),
}


def _get(path: str) -> Any:
    resp = requests.get(f"{API_URL}{path}", timeout=TIMEOUT, headers={"User-Agent": USER_AGENT})
    resp.raise_for_status()
    return resp.json()


def _post(path: str, body: dict) -> tuple[int, Any]:
    resp = requests.post(f"{API_URL}{path}", json=body, timeout=TIMEOUT, headers={"User-Agent": USER_AGENT})
    try:
        data = resp.json()
    except ValueError:
        data = {"error": resp.text[:500]}
    return resp.status_code, data


def fetch_tools() -> list[types.Tool]:
    data = _get("/api/tools")
    return [
        types.Tool(
            name=t["name"],
            title=t.get("title"),
            description=t.get("description"),
            input_schema=t.get("input_schema") or {"type": "object", "properties": {}},
            annotations=types.ToolAnnotations(read_only_hint=True, open_world_hint=True),
        )
        for t in data.get("tools", [])
    ]


def run_tool(name: str, arguments: dict | None) -> types.CallToolResult:
    try:
        status, data = _post(f"/api/tools/{name}", arguments or {})
    except requests.RequestException as exc:
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=f"Could not reach the NISAR backend at {API_URL}: {exc}")],
            is_error=True,
        )
    if status != 200:
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=f"Error: {data.get('error', status)}")],
            is_error=True,
        )
    result = data.get("result")
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=1))],
        structured_content=result if isinstance(result, dict) else {"result": result},
    )


async def on_list_tools(ctx, params) -> types.ListToolsResult:
    tools = await anyio.to_thread.run_sync(fetch_tools)
    return types.ListToolsResult(tools=tools)


async def on_call_tool(ctx, params: types.CallToolRequestParams) -> types.CallToolResult:
    return await anyio.to_thread.run_sync(run_tool, params.name, params.arguments)


async def on_list_resources(ctx, params) -> types.ListResourcesResult:
    return types.ListResourcesResult(resources=[
        types.Resource(name="primer", title="How to read NISAR data", uri="nisar://primer",
                       mime_type="text/markdown", description="Backscatter, polarization, L-band, displacement and caveats."),
        types.Resource(name="hypotheses", title="How to write a hypothesis", uri="nisar://hypotheses",
                       mime_type="text/markdown", description="The six-part shape every hypothesis takes, and why no causes."),
        types.Resource(name="stories", title="Stories", uri="nisar://stories",
                       mime_type="application/json", description="The curated stories and their themes."),
        types.Resource(name="openapi", title="REST API description", uri="nisar://openapi",
                       mime_type="application/json", description="OpenAPI 3.1 spec of the platform's REST API."),
    ])


async def on_read_resource(ctx, params: types.ReadResourceRequestParams) -> types.ReadResourceResult:
    uri = str(params.uri)
    if uri == "nisar://primer":
        text, mime = PRIMER, "text/markdown"
    elif uri == "nisar://hypotheses":
        text, mime = HYPOTHESIS_GUIDE, "text/markdown"
    elif uri == "nisar://stories":
        text = json.dumps(await anyio.to_thread.run_sync(_get, "/api/stories"), indent=1, ensure_ascii=False)
        mime = "application/json"
    elif uri == "nisar://openapi":
        text = json.dumps(await anyio.to_thread.run_sync(_get, "/api/openapi.json"), indent=1)
        mime = "application/json"
    else:
        raise ValueError(f"unknown resource {uri}")
    return types.ReadResourceResult(contents=[types.TextResourceContents(uri=uri, mime_type=mime, text=text)])


async def on_list_prompts(ctx, params) -> types.ListPromptsResult:
    return types.ListPromptsResult(prompts=list(PROMPTS.values()))


async def on_get_prompt(ctx, params: types.GetPromptRequestParams) -> types.GetPromptResult:
    args = params.arguments or {}
    if params.name == "tell_story":
        text = (
            f"Tell the NISAR story '{args.get('story', '')}'. Call get_story, then walk through its chapters: "
            "the question; what NISAR measured (quote moments with units and dates); each hypothesis with its "
            "mechanism, polarization channel, what is consistent with it, its alternative and its test, labelled "
            "as a hypothesis; what NISAR can't see there; and what a longer record could make possible. "
            "Read nisar://hypotheses first. End with the workspace link."
        )
    elif params.name == "draft_finding":
        moment = f" (moment {args['moment']})" if args.get("moment") not in (None, "") else ""
        text = (
            f"Call build_finding for the story '{args.get('story', '')}'{moment} and write a one-page brief for a "
            "decision maker: one-sentence finding (measured), the evidence (passes, dates, coverage), how "
            "confident the record is, the hypotheses (labelled, with alternatives), what NISAR can't see, what "
            "an operational service would need, and the citation. No advice and no causal claims."
        )
    elif params.name == "scout_area":
        q = f" The question is: {args['question']}." if args.get("question") else ""
        text = (
            f"Can NISAR help in the area {args.get('bbox', '')}?{q} If that is a place name rather than "
            "coordinates, call find_place first and use its search_bbox. Call coverage_check, then say which products "
            "have passes, how often on one frame, the quality mix, and what kinds of change each could support. "
            "If a series is feasible, suggest the next tool (search_granules or the workspace). Be explicit "
            "about what NISAR could not tell."
        )
    elif params.name == "investigate_site":
        text = (
            f"Investigate the NISAR study site '{args.get('site', '')}'. Call get_site_timeseries and "
            "explain_site_change, then write a short brief: what NISAR measured (with units and dates), "
            "how the related series line up in time (as context, not causes), what the record cannot "
            "tell us, and a link to open it in the workspace. Use search_docs for any concept you explain."
        )
    elif params.name == "check_my_area":
        when = f" between {args['start']} and {args['end']}" if args.get("start") and args.get("end") else ""
        text = (
            f"Check the area {args.get('bbox', '')}{when} for surface change. Call search_granules for GCOV "
            "and GUNW, then area_rain for the same dates. Summarise which NISAR passes exist, what kinds of "
            "change they could show, and whether rain could explain a change. Be explicit about uncertainty."
        )
    else:
        raise ValueError(f"unknown prompt {params.name}")
    return types.GetPromptResult(
        description=PROMPTS[params.name].description,
        messages=[types.PromptMessage(role="user", content=types.TextContent(type="text", text=text))],
    )


def build_server() -> Server:
    return Server(
        "nisar-explorer",
        version="1.2.0",
        title="NISAR Surface Change Explorer",
        description="NISAR radar surface-change data, the NASA catalog and science docs.",
        instructions=INSTRUCTIONS,
        on_list_tools=on_list_tools,
        on_call_tool=on_call_tool,
        on_list_resources=on_list_resources,
        on_read_resource=on_read_resource,
        on_list_prompts=on_list_prompts,
        on_get_prompt=on_get_prompt,
    )


async def _run_stdio() -> None:
    from mcp.server.stdio import stdio_server

    server = build_server()
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--http", action="store_true", help="serve streamable HTTP instead of stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args(argv)
    if args.http:
        import uvicorn

        app = build_server().streamable_http_app(host=args.host)
        uvicorn.run(app, host=args.host, port=args.port)
    else:
        anyio.run(_run_stdio)


if __name__ == "__main__":
    main()
