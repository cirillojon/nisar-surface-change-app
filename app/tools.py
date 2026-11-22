"""Shared tool registry: one definition per tool, used three ways.

* ``GET /api/tools`` / ``POST /api/tools/<name>`` (``app/routes/tools.py``)
  expose the tools over HTTP. The docs' "Try it" panels use these.
* The MCP server (``mcp_server/``) lists and calls these same tools, so
  any MCP client (Claude, Cursor, ...) gets exactly what the docs show.
* The AI assistant (``app/assistant.py``) hands them to the model.

Each tool has a name, a title, a description written for a model to read,
a JSON Schema for its arguments, and a handler. Handlers run inside a
Flask app context and return plain JSON-able data, trimmed so a model can
read it: daily series are summarized, long lists capped.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable

import requests

from app import auto, chains, db, geocode, nisar, stories
from app.change_types import change_type_list
from app.models import Site
from app.validators import validate_bbox, validate_optional_date

REPO_ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR = REPO_ROOT / "frontend" / "src" / "content" / "docs"
LANDCHANGE_PATH = Path(__file__).resolve().parent / "data" / "landchange.json"

CAVEAT = (
    "Most NISAR granules here are PROVISIONAL, early-mission products, and each record is about "
    "a year long. Related series (rain, river flow) are context only: the platform "
    "tests no causes and gives no advice."
)


class ToolError(ValueError):
    """Bad arguments or nothing found; the message is shown to the caller."""


@dataclass(frozen=True)
class Tool:
    name: str
    title: str
    description: str
    input_schema: dict
    handler: Callable[..., Any]

    def describe(self) -> dict:
        return {
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "input_schema": self.input_schema,
        }


# ─── argument helpers ─────────────────────────────────────

BBOX_SCHEMA = {
    "type": "array",
    "items": {"type": "number"},
    "minItems": 4,
    "maxItems": 4,
    "description": "[min_lon, min_lat, max_lon, max_lat] in degrees (WGS84).",
}
DATE_SCHEMA = {"type": "string", "format": "date", "description": "YYYY-MM-DD"}
SITE_SCHEMA = {
    "type": "string",
    "description": "Site id, slug (e.g. 'sylhet-haor-floods') or part of its name (e.g. 'Sylhet').",
}


def _bbox(value) -> list[float]:
    try:
        return validate_bbox(value)
    except ValueError as exc:
        raise ToolError(str(exc)) from None


def _dates(start, end, default_days=None) -> tuple[date, date]:
    try:
        end_d = validate_optional_date(end, "end")
        start_d = validate_optional_date(start, "start")
    except ValueError as exc:
        raise ToolError(str(exc)) from None
    if default_days is not None:
        end_d = end_d or date.today()
        start_d = start_d or end_d - timedelta(days=default_days)
    if start_d is None or end_d is None:
        raise ToolError("start and end dates are required (YYYY-MM-DD)")
    if start_d > end_d:
        raise ToolError("start must be on or before end")
    return start_d, end_d


def resolve_site(ref) -> Site:
    """A site by id, slug or (case-insensitive) part of its name."""
    if ref is None or str(ref).strip() == "":
        raise ToolError("site is required")
    text = str(ref).strip()
    if text.isdigit():
        site = db.session.get(Site, int(text))
        if site:
            return site
    site = Site.query.filter_by(slug=text).first()
    if site:
        return site
    needle = text.lower()
    matches = [s for s in Site.query.order_by(Site.name).all()
               if needle in s.name.lower() or needle in s.slug]
    if len(matches) == 1:
        return matches[0]
    names = ", ".join(f"{s.name} ({s.slug})" for s in (matches or Site.query.order_by(Site.name).all()))
    raise ToolError(
        f"{'Several' if matches else 'No'} sites match {text!r}. Choose one of: {names}"
    )


def workspace_url(slug: str | None = None, day: str | None = None) -> str:
    params = []
    if slug:
        params.append(f"site={slug}")
    if day:
        params.append(f"date={day}")
    return "/workspace" + ("?" + "&".join(params) if params else "")


def _round(v, nd=2):
    return round(v, nd) if isinstance(v, (int, float)) else v


# ─── handlers ─────────────────────────────────────────────

def list_sites(change_type: str | None = None) -> dict:
    q = Site.query
    if change_type:
        q = q.filter(Site.change_type == change_type)
    rows = []
    for s in q.order_by(Site.name).all():
        d = s.to_dict()
        rows.append({
            "id": d["id"], "slug": d["slug"], "name": d["name"],
            "change_type": d["change_type"], "product": d["product"],
            "passes": d["scene_count"], "first_date": d["first_date"], "last_date": d["last_date"],
            "bbox": d["bbox"], "summary": (d["description"] or "")[:400],
            "workspace_url": workspace_url(d["slug"]),
        })
    return {"sites": rows, "count": len(rows)}


def get_site_timeseries(site: str, metric: str | None = None) -> dict:
    s = resolve_site(site)
    d = s.to_dict(detail=True)
    series: dict[str, list] = {}
    units: dict[str, str] = {}
    for o in d["observations"]:
        if metric and o["metric"] != metric:
            continue
        series.setdefault(o["metric"], []).append([o["observed_on"], _round(o["value"])])
        units[o["metric"]] = o["unit"]
    for rows in series.values():
        rows.sort()
    return {
        "site": {k: d[k] for k in ("id", "slug", "name", "change_type", "product", "frame", "bbox", "reference")},
        "description": d["description"],
        "story_metric": d.get("story_metric"),
        "units": units,
        "series": {k: [{"date": a, "value": b} for a, b in v] for k, v in series.items()},
        "passes": [
            {"date": sc["date"], "quality": sc["quality"], "valid_pct": sc["valid_pct"], "granule_id": sc["granule_id"]}
            for sc in d["scenes"]
        ],
        "workspace_url": workspace_url(d["slug"]),
        "caveat": CAVEAT,
    }


def explain_site_change(site: str) -> dict:
    s = resolve_site(site)
    chain = chains.get_site_chain(s.to_dict(detail=True))
    radar = chain.get("radar") or {}
    radar_by_date = {p["date"]: p.get("value") for p in radar.get("points") or []}
    drivers = []
    for drv in chain.get("drivers") or []:
        per_pass = drv.get("per_pass") or []
        drivers.append({
            k: drv.get(k) for k in ("id", "label", "kind", "place", "unit", "note", "summary", "aggregate")
            if drv.get(k) is not None
        } | {"per_pass": [
            p | {"radar": radar_by_date.get(p["date"])} for p in per_pass
        ]})
    moments = [
        {k: m.get(k) for k in ("title", "label", "caption", "start", "end", "display", "detail")}
        for m in chain.get("moments") or []
    ]
    return {
        "site": {"slug": s.slug, "name": s.name, "change_type": s.change_type},
        "available": chain.get("available"),
        "window_days": chain.get("window_days"),
        "radar": {k: radar.get(k) for k in ("metric", "label", "unit", "product", "cumulative", "summary")}
        | {"points": [{"date": p["date"], "value": p.get("value")} for p in radar.get("points") or []]},
        "drivers": drivers,
        "footprint": chain.get("footprint"),
        "moments": moments,
        "comparison_note": "Drivers are shown for comparison on the same dates as the NISAR passes "
                           "(each driver value covers the window_days before a pass). Lining up in time "
                           "doesn't show that one affects the other; the platform tests no causes.",
        "workspace_url": workspace_url(s.slug),
        "caveat": CAVEAT,
    }


def list_change_types() -> dict:
    return {"change_types": change_type_list()}


def list_products() -> dict:
    return {"products": nisar.product_list()}


def search_granules(bbox, product: str = "GCOV", start: str | None = None,
                    end: str | None = None, limit: int = 10) -> dict:
    box = _bbox(bbox)
    if product not in nisar.PRODUCTS:
        raise ToolError(f"product must be one of {', '.join(nisar.PRODUCTS)}")
    start_d, end_d = _dates(start, end, default_days=90)
    try:
        limit = max(1, min(int(limit), 50))
    except (TypeError, ValueError):
        raise ToolError("limit must be an integer") from None
    try:
        found = nisar.search_granules(box, start_d, end_d, product=product, limit=limit)
    except nisar.NisarSearchError as exc:
        raise ToolError(f"NASA CMR search failed: {exc}") from None
    granules = [
        {k: g.get(k) for k in ("title", "start", "quality", "size_mb", "bbox", "data_url", "browse_url")}
        for g in found.get("granules", [])
    ]
    return {
        "product": product, "start": start_d.isoformat(), "end": end_d.isoformat(),
        "hits": found.get("hits"), "granules": granules,
        "note": "data_url needs an Earthdata login to download.",
    }


def area_rain(bbox, start: str, end: str) -> dict:
    box = _bbox(bbox)
    start_d, end_d = _dates(start, end)
    if (end_d - start_d).days > 800:
        raise ToolError("Keep the range under about two years.")
    ctx = chains.get_area_context(box, start_d, end_d)
    out = []
    for drv in ctx.get("drivers") or []:
        values = [p for p in (drv.get("series") or []) if p.get("value") is not None]
        total = sum(p["value"] for p in values)
        wettest = max(values, key=lambda p: p["value"], default=None)
        monthly: dict[str, float] = {}
        for p in values:
            monthly[p["date"][:7]] = monthly.get(p["date"][:7], 0) + p["value"]
        out.append({
            "label": drv.get("label"), "place": drv.get("place"), "note": drv.get("note"),
            "unit": drv.get("unit", "mm"), "days": len(values), "total": _round(total, 1),
            "wettest_day": wettest, "monthly_totals": {k: _round(v, 1) for k, v in monthly.items()},
        })
    return {"bbox": box, "start": start_d.isoformat(), "end": end_d.isoformat(), "drivers": out}


def soil_moisture_scene(granule: str, bbox) -> dict:
    from app import sme2

    box = _bbox(bbox)
    try:
        title = sme2.validate_title(granule or "")
        box = sme2.validate_area(box)
        scene = sme2.get_scene(title, box)
    except ValueError as exc:
        raise ToolError(str(exc)) from None
    except sme2.Sme2Error as exc:
        raise ToolError(str(exc)) from None
    return {k: v for k, v in scene.items() if k != "images"} | {
        "note": (
            "soil_moisture is volumetric (m³/m³) on a 200 m grid (5+5 MHz passes aggregated to "
            "400 m); accuracy goal 0.06 where unflagged and vegetation is light. Retrieval-quality "
            "flags are not applied by this app."
        )
    }


def list_land_change(kind: str | None = None) -> dict:
    if not LANDCHANGE_PATH.is_file():
        return {"sites": []}
    data = json.loads(LANDCHANGE_PATH.read_text(encoding="utf-8"))
    curated = {s["slug"] for s in data.get("sites", [])}
    rows = []
    for s in data.get("sites", []) + [p for p in auto.gallery_places() if p["slug"] not in curated]:
        if s.get("hidden"):
            continue
        if kind and kind.lower() not in (s.get("kind") or "").lower():
            continue
        passes = s.get("passes") or []
        rows.append({
            "slug": s.get("slug"), "name": s.get("name"), "kind": s.get("kind"),
            "region": s.get("region"), "headline": s.get("headline"),
            "status": {"visible": "clearly visible", "likely": "likely, verify",
                       "not_visible": "nothing visible yet",
                       auto.STATUS: auto.STATUS_LABEL.lower()}.get(s.get("status"), s.get("status")),
            "look_for": s.get("look_for"), "reason": s.get("reason"), "bbox": s.get("bbox"),
            "passes": len(passes),
            "first_date": passes[0].get("date") if passes else None,
            "last_date": passes[-1].get("date") if passes else None,
        })
    return {"method": data.get("method"), "sites": rows}


def height_profile(line) -> dict:
    from app import profiles

    try:
        status = profiles.start(line)
    except ValueError as exc:
        raise ToolError(str(exc)) from None
    except profiles.ProfileError as exc:
        raise ToolError(str(exc)) from None
    pid = status["id"]
    if status.get("state") != "done":
        return {"id": pid, "state": status.get("state"), "progress": status.get("progress"),
                "note": "A new line takes a few minutes. Call this tool again with the same line to check."}
    full = profiles.get(pid) or {}
    r = full.get("result") or {}
    by_date = []
    for day, row in zip(r.get("dates") or [], r.get("vertical_mm") or r.get("los_mm") or []):
        vals = [v for v in (row or []) if v is not None]
        if vals:
            by_date.append({"date": day, "min_mm": _round(min(vals), 1), "max_mm": _round(max(vals), 1)})
    return {
        "id": pid, "state": "done",
        "length_km": r.get("length_km"), "frame": r.get("frame"),
        "first_date": r.get("first_date"), "last_date": r.get("last_date"),
        "pairs_used": r.get("pairs_used"), "corrections": r.get("corrections"),
        "noise_mm": r.get("noise_mm"),
        "vertical_range_by_date": by_date,
        "note": "Values are relative to the line's median; + is up (vertical) or toward the satellite (LOS).",
    }


# ─── docs search ──────────────────────────────────────────

_TITLE_RE = re.compile(r"title:\s*[\"']?(.+?)[\"']?\s*[,}\n]")
_MDX_NOISE = re.compile(r"^(import|export)\b.*$|<[^>]+>|\{[^}]*\}", re.M)


# Repository docs rendered inside docs pages (frontend/src/content/docs/*).
REPO_DOCS = {
    "DATA_AND_METHODS.md": ("/docs/data/methods", "Data, methods & evidence"),
    "ARCHITECTURE.md": ("/docs/developers/architecture", "Architecture & data pipeline"),
    "DEPLOYMENT.md": ("/docs/developers/deployment", "Deployment"),
    "TROUBLESHOOTING.md": ("/docs/developers/deployment", "Troubleshooting"),
}


def _doc_index() -> list[dict]:
    docs = []
    for name, (path, title) in REPO_DOCS.items():
        md = REPO_ROOT / "docs" / name
        if md.is_file():
            docs.append({"path": path, "title": title, "text": md.read_text(encoding="utf-8")})
    if not DOCS_DIR.is_dir():
        return docs
    for path in sorted(DOCS_DIR.rglob("*.mdx")):
        raw = path.read_text(encoding="utf-8")
        m = _TITLE_RE.search(raw)
        rel = path.relative_to(DOCS_DIR).with_suffix("").as_posix()
        text = _MDX_NOISE.sub(" ", raw)
        docs.append({"path": f"/docs/{rel}", "title": m.group(1) if m else rel, "text": text})
    return docs


def search_docs(query: str, limit: int = 4) -> dict:
    words = [w for w in re.findall(r"[a-z0-9]+", (query or "").lower()) if len(w) > 2]
    if not words:
        raise ToolError("query is required")
    scored = []
    for doc in _doc_index():
        low = doc["text"].lower()
        title = doc["title"].lower()
        score = sum(low.count(w) + 8 * title.count(w) for w in words)
        if score:
            scored.append((score, doc))
    scored.sort(key=lambda x: -x[0])
    results = []
    for _, doc in scored[: max(1, min(int(limit), 8))]:
        text = re.sub(r"\s+", " ", doc["text"]).strip()
        low = text.lower()
        pos = min((low.find(w) for w in words if w in low), default=0)
        excerpt = text[max(0, pos - 300): pos + 1200]
        results.append({"title": doc["title"], "path": doc["path"], "excerpt": excerpt})
    return {"query": query, "results": results}


# ─── stories, findings, coverage (the workspace's three modes) ────────────

def _story_call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except stories.StoryError as exc:
        raise ToolError(str(exc)) from None


def list_stories_tool(theme: str | None = None, since: str | None = None, until: str | None = None,
                      origin: str | None = None, sort: str = "default") -> dict:
    return _story_call(stories.list_stories, theme, since=since, until=until, origin=origin, sort=sort)


def get_story_tool(story: str) -> dict:
    slug = _story_call(stories.resolve_story_slug, story)
    return _story_call(stories.get_story, slug)


def build_finding_tool(story: str, moment: int | None = None) -> dict:
    slug = _story_call(stories.resolve_story_slug, story)
    return _story_call(stories.build_finding, slug, moment)


def export_site_series(site: str) -> dict:
    s = resolve_site(site)
    text = _story_call(stories.series_csv, s.slug)
    return {"site": s.slug, "filename": f"nisar-{s.slug}.csv", "rows": len(text.splitlines()) - 1,
            "download_url": f"/api/stories/{s.slug}/series.csv", "csv": text}


def coverage_check_tool(bbox, start: str | None = None, end: str | None = None) -> dict:
    box = _bbox(bbox)
    try:
        start_d = validate_optional_date(start, "start")
        end_d = validate_optional_date(end, "end")
    except ValueError as exc:
        raise ToolError(str(exc)) from None
    start_d, end_d = _story_call(stories.default_window, start_d, end_d)
    return stories.coverage_check(box, start_d, end_d)


# A searched place larger than this (degrees a side) is searched as a box
# this size around its center, as the workspace's place search does
# (PLACE_MAX_SPAN_DEG and AOI_HALF_DEG in frontend/src/workspace/mapLayers.js).
PLACE_MAX_SPAN_DEG = 3.0
PLACE_MIN_SPAN_DEG = 0.5


def search_box(place: dict) -> tuple[list[float], bool]:
    """The box to search NISAR over for a place, and whether it was cut down to fit."""
    lon, lat = place["longitude"], max(-89.5, min(89.5, place["latitude"]))
    west, south, east, north = place["bbox"]
    lon_span = east - west if west <= east else 360.0
    lat_span = north - south
    clipped = lon_span > PLACE_MAX_SPAN_DEG or lat_span > PLACE_MAX_SPAN_DEG
    c_lon = lon if clipped or west > east else (west + east) / 2
    c_lat = lat if clipped else (south + north) / 2
    def half(span):
        return min(PLACE_MAX_SPAN_DEG, max(PLACE_MIN_SPAN_DEG, span)) / 2
    box = [
        round(max(c_lon - half(lon_span), -180), 3), round(max(c_lat - half(lat_span), -90), 3),
        round(min(c_lon + half(lon_span), 180), 3), round(min(c_lat + half(lat_span), 90), 3),
    ]
    return box, clipped


def find_place(query: str) -> dict:
    try:
        q = geocode.clean_query(query)
    except ValueError as exc:
        raise ToolError(str(exc)) from None
    try:
        places = geocode.search(q)
    except requests.RequestException:
        raise ToolError("Place search is temporarily unavailable; try again in a moment.") from None
    if not places:
        raise ToolError(f"No places match {q!r}. Try a fuller name, e.g. 'Lake Chad, Chad'.")
    results = []
    for p in places:
        box, clipped = search_box(p)
        results.append({**p, "search_bbox": box, "search_bbox_clipped": clipped})
    return {
        "query": q,
        "results": results,
        "note": ("search_bbox is the box to pass to coverage_check, search_granules or area_rain: the place's "
                 f"own box, or a {PLACE_MAX_SPAN_DEG:g}° box around its center when the place is larger "
                 "(search_bbox_clipped)."),
        "attribution": geocode.ATTRIBUTION,
    }


def open_in_workspace(site: str | None = None, date: str | None = None) -> dict:
    slug = resolve_site(site).slug if site else None
    return {"url": workspace_url(slug, date)}


# ─── registry ─────────────────────────────────────────────

TOOLS: list[Tool] = [
    Tool("list_sites", "List study sites",
         "List the curated NISAR study sites (floods, crops, subsidence) with their product, "
         "number of passes, date range, bounding box and a short summary of what NISAR shows there.",
         {"type": "object", "properties": {"change_type": {
             "type": "string", "enum": ["agriculture", "flood_wetland", "subsidence", "deformation"],
             "description": "Only sites of this change type."}}},
         list_sites),
    Tool("get_site_timeseries", "Get a site's time series",
         "Measured NISAR values for one study site, per pass: HH/HV backscatter (dB) and open-water share (%) "
         "for GCOV sites, cumulative line-of-sight displacement (mm) for GUNW sites. Includes each pass's "
         "granule id and quality.",
         {"type": "object", "required": ["site"], "properties": {
             "site": SITE_SCHEMA,
             "metric": {"type": "string", "enum": ["hh_db", "hv_db", "water_pct", "los_mm"],
                        "description": "Only this metric."}}},
         get_site_timeseries),
    Tool("explain_site_change", "Context for a site's change",
         "The NISAR story for a study site: the radar series, the 'moments' that sum it up, related physical "
         "series (rain, river flow, earthquakes) lined up on the same pass dates. Open water is compared over "
         "the area every pass imaged (see 'footprint'). "
         "These series are shown for comparison only: describe how they line up in time, but never claim one "
         "caused the other.",
         {"type": "object", "required": ["site"], "properties": {"site": SITE_SCHEMA}},
         explain_site_change),
    Tool("list_change_types", "List change types",
         "The kinds of surface change tracked, the NISAR product each uses, and the metrics (with units "
         "and what they mean physically).",
         {"type": "object", "properties": {}},
         list_change_types),
    Tool("list_products", "List NISAR products",
         "The NISAR data products that can be searched (GCOV, GUNW, GOFF, GSLC, SME2) and what each is for.",
         {"type": "object", "properties": {}},
         list_products),
    Tool("search_granules", "Search NISAR granules",
         "Search NASA's catalog for NISAR granules of one product over a bounding box and date range "
         "(default: the last 90 days). Returns acquisition times, quality, footprints and download links.",
         {"type": "object", "required": ["bbox"], "properties": {
             "bbox": BBOX_SCHEMA,
             "product": {"type": "string", "enum": ["GCOV", "GUNW", "GOFF", "GSLC", "SME2"], "default": "GCOV"},
             "start": DATE_SCHEMA, "end": DATE_SCHEMA,
             "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10}}},
         search_granules),
    Tool("area_rain", "Rain over an area",
         "Rain at the center of a bounding box between two dates (a weather model's estimate, not a gauge): "
         "total, wettest day and monthly totals. Use it to compare rain with change NISAR saw; lining up "
         "in time does not show cause.",
         {"type": "object", "required": ["bbox", "start", "end"], "properties": {
             "bbox": BBOX_SCHEMA, "start": DATE_SCHEMA, "end": DATE_SCHEMA}},
         area_rain),
    Tool("soil_moisture_scene", "Soil moisture for one pass",
         "Read one NISAR SME2 soil-moisture granule over an area (up to 30° per side): median soil moisture "
         "(m³/m³), HH/HV backscatter and open-water share. Get granule names from search_granules with "
         "product=SME2. The first read takes 5–15 s.",
         {"type": "object", "required": ["granule", "bbox"], "properties": {
             "granule": {"type": "string", "description": "SME2 granule title."}, "bbox": BBOX_SCHEMA}},
         soil_moisture_scene),
    Tool("list_land_change", "List the land-change gallery",
         "Places checked for dramatic change (volcanoes, glaciers, floods, landslides, fires, "
         "construction) with what to look for, the passes available, and status: whether the change is "
         "clearly visible in NISAR so far, likely (verify), or not visible yet.",
         {"type": "object", "properties": {"kind": {"type": "string", "description": "Filter by kind, e.g. 'volcano', 'glacier', 'flood'."}}},
         list_land_change),
    Tool("height_profile", "Ground motion along a line",
         "Measure vertical ground motion along a line (up to 100 km) over NISAR's full interferogram record. "
         "A new line runs in the background for a few minutes; call again with the same line to get the result.",
         {"type": "object", "required": ["line"], "properties": {"line": {
             "type": "array", "minItems": 2,
             "items": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
             "description": "Points as [lon, lat]."}}},
         height_profile),
    Tool("search_docs", "Search the documentation",
         "Search this platform's documentation (science explainers, product guides, methods, API docs) and "
         "return the best-matching pages with excerpts. Cite the page path when you use it.",
         {"type": "object", "required": ["query"], "properties": {
             "query": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 8, "default": 4}}},
         search_docs),
    Tool("list_stories", "List stories",
         "The workspace's curated stories (floods, crops, subsidence, the Amazon, Greenland ice, volcanoes, "
         "landslides), grouped by theme. Each story asks a question "
         "and offers labeled physical hypotheses. Also lists auto-detected stories (origin 'auto'): "
         "templated, numbers-only changes the daily watch job found in new passes, not reviewed by a person "
         "and with no hypotheses. Each story's 'date' is the pass it is about; filter with since/until.",
         {"type": "object", "properties": {
             "theme": {"type": "string", "enum": ["water", "food", "ground", "ice", "forest"],
                       "description": "Only stories of this theme."},
             "since": {"type": "string", "format": "date", "description": "Only stories about passes on or after this date."},
             "until": {"type": "string", "format": "date", "description": "Only stories about passes on or before this date."},
             "origin": {"type": "string", "enum": ["curated", "auto"], "description": "Curated or auto-detected stories only."},
             "sort": {"type": "string", "enum": ["default", "newest"], "description": "'newest' sorts by date, newest first."}}},
         list_stories_tool),
    Tool("get_story", "Get a story",
         "One story in five chapters: the question, what NISAR measured (moments with numbers and dates), "
         "physical hypotheses (driver, mechanism, polarization channel, what in the record is consistent "
         "with it, an alternative explanation and a test), what NISAR can't see there, and future "
         "applications. Present hypotheses as hypotheses, never as established causes.",
         {"type": "object", "required": ["story"], "properties": {"story": {
             "type": "string", "description": "Story slug (e.g. 'okavango-flood-pulse', 'jakobshavn') or part of its title."}}},
         get_story_tool),
    Tool("build_finding", "Build a finding",
         "Turn one moment of a story into a shareable finding: the measured claim, the passes behind it "
         "(dates, quality, coverage, granule ids), a confidence summary, matching hypotheses, series to "
         "compare with, what can't be seen, links to reproduce it (workspace, REST, CSV) and a citation.",
         {"type": "object", "required": ["story"], "properties": {
             "story": {"type": "string", "description": "Story slug or part of its title."},
             "moment": {"type": "integer", "minimum": 0,
                        "description": "Index of the moment (from get_story); default is the story's key moment."}}},
         build_finding_tool),
    Tool("export_site_series", "Export a site's series as CSV",
         "Every NISAR value at a study site as CSV: one row per pass and metric, with unit, quality, "
         "share of the box covered and granule id.",
         {"type": "object", "required": ["site"], "properties": {"site": SITE_SCHEMA}},
         export_site_series),
    Tool("coverage_check", "Check NISAR coverage over an area",
         "Can NISAR answer a question here? For a bounding box and window (default: the last year), count "
         "passes per product (GCOV, GUNW, GOFF, SME2), the median days between passes, the track/frames "
         "and the quality mix, with a plain verdict on what each product could support.",
         {"type": "object", "required": ["bbox"], "properties": {
             "bbox": BBOX_SCHEMA, "start": DATE_SCHEMA, "end": DATE_SCHEMA}},
         coverage_check_tool),
    Tool("find_place", "Find a place by name",
         "Look up a town, region, lake, volcano or country by name (OpenStreetMap) and get its position, "
         "its bounding box and a search_bbox ready for coverage_check, search_granules or area_rain. "
         "Use it whenever someone names a place instead of giving coordinates. Up to 6 matches, best first; "
         "if several fit, say which one you used.",
         {"type": "object", "required": ["query"], "properties": {"query": {
             "type": "string", "minLength": 2, "maxLength": 120,
             "description": "A place name, e.g. 'Lake Chad', 'Mount Etna', 'Jakarta, Indonesia'."}}},
         find_place),
    Tool("open_in_workspace", "Link to the map workspace",
         "Build a link that opens the interactive map workspace on a study site (and optionally a pass date).",
         {"type": "object", "properties": {"site": SITE_SCHEMA, "date": DATE_SCHEMA}},
         open_in_workspace),
]

TOOLS_BY_NAME = {t.name: t for t in TOOLS}


def call_tool(name: str, arguments: dict | None) -> Any:
    tool = TOOLS_BY_NAME.get(name)
    if tool is None:
        raise KeyError(name)
    args = arguments or {}
    if not isinstance(args, dict):
        raise ToolError("arguments must be a JSON object")
    allowed = set(tool.input_schema.get("properties", {}))
    unknown = set(args) - allowed
    if unknown:
        raise ToolError(f"unknown argument(s): {', '.join(sorted(unknown))}")
    missing = [k for k in tool.input_schema.get("required", []) if args.get(k) in (None, "")]
    if missing:
        raise ToolError(f"missing argument(s): {', '.join(missing)}")
    return tool.handler(**args)

