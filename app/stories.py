"""Stories, their evidence cards, CSV export and the coverage check.

* **Stories** (``list_stories`` / ``get_story``): curated places told in
  five chapters: the question, what NISAR saw (the site's moments from
  ``app/chains.py`` or a gallery place's passes), labelled physical
  hypotheses, what NISAR can't see there, and what a longer record could
  make possible. Content lives in ``app/data/stories.json``.
* **Evidence cards** (``build_finding`` / ``series_csv``): one moment of a
  story as a shareable card (a story's "Save / share"): the measured
  claim, the passes behind it, how confident the record is, hypotheses,
  series to compare with, and links to reproduce it (workspace, REST,
  MCP, CSV, printable brief at ``/brief/<slug>``).
* **Auto-detected stories** (``app/auto.py``): templated, numbers-only
  stories the NISAR Watch job publishes as new passes arrive, merged into
  the list with ``origin: "auto"``. ``list_stories`` / ``story_feed`` filter
  any story by the date of the passes it is about (``since`` / ``until``).
* **Investigate** (``coverage_check``): for any drawn box, which NISAR
  products have passes, how often, on which tracks and at what quality,
  so a researcher can judge whether NISAR can answer their question.

Findings a viewer writes themselves (notes, their own stories) stay in
their browser; the API only builds the app's own analysis.

Hypotheses are explanations the data raises, never tested causes: each
comes with an alternative and a test (docs/DATA_AND_METHODS.md §1).
"""
from __future__ import annotations

import csv
import io
import json
import re
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from statistics import median

from app import auto, chains, db, nisar
from app.change_types import METRICS
from app.models import Scene, Site

DATA_DIR = Path(__file__).resolve().parent / "data"
STORIES_PATH = DATA_DIR / "stories.json"
LANDCHANGE_PATH = DATA_DIR / "landchange.json"

# Passes seeing less of the box than this are flagged (as in the workspace).
FULL_COVERAGE = 95
HYPOTHESIS_LABEL = "Hypothesis: not tested here"
CAVEAT = (
    "Most NISAR granules here are PROVISIONAL, early-mission products, and each record is about "
    "a year long. Hypotheses are physical explanations the data raises, not tested causes. "
    "Related series (rain, river flow) are shown for comparison only."
)
COVERAGE_PRODUCTS = ("GCOV", "GUNW", "GOFF", "SME2")
_FRAME_RE = re.compile(r"_(\d{3})_([AD])_(\d{3})_")


class StoryError(ValueError):
    """Unknown story, bad moment, or bad arguments; shown to the caller."""


# ─── content ──────────────────────────────────────────────

@lru_cache(maxsize=1)
def _content_cached(mtime: float, auto_mtime: float) -> dict:
    data = json.loads(STORIES_PATH.read_text(encoding="utf-8"))
    curated = {s["slug"] for s in data["stories"]}
    # A promoted auto story is replaced by its curated version.
    data["stories"] += [s for s in auto.stories() if s["slug"] not in curated]
    return data


def content() -> dict:
    """Curated stories, then active auto-detected ones."""
    return _content_cached(STORIES_PATH.stat().st_mtime, auto.mtime())


@lru_cache(maxsize=1)
def _landchange_cached(mtime: float, auto_mtime: float) -> dict:
    data = (json.loads(LANDCHANGE_PATH.read_text(encoding="utf-8"))
            if LANDCHANGE_PATH.is_file() else {"sites": []})
    curated = {s["slug"] for s in data["sites"]}
    data["sites"] += [p for p in auto.gallery_places() if p["slug"] not in curated]
    return data


def landchange() -> dict:
    """The gallery: curated places, then auto places that have an active story."""
    mtime = LANDCHANGE_PATH.stat().st_mtime if LANDCHANGE_PATH.is_file() else 0.0
    return _landchange_cached(mtime, auto.mtime())


def _land_site(slug: str) -> dict | None:
    return next((s for s in landchange().get("sites", []) if s.get("slug") == slug), None)


def _story(slug: str) -> dict:
    story = next((s for s in content()["stories"] if s["slug"] == slug), None)
    if story is None:
        slugs = ", ".join(s["slug"] for s in content()["stories"])
        raise StoryError(f"No story {slug!r}. Stories: {slugs}")
    return story


def resolve_story_slug(ref) -> str:
    """A story slug from a slug or (case-insensitive) part of a title or slug."""
    text = str(ref or "").strip().lower()
    if not text:
        raise StoryError("story is required")
    stories = content()["stories"]
    exact = [s for s in stories if s["slug"] == text]
    if exact:
        return exact[0]["slug"]
    matches = [s for s in stories if text in s["slug"] or text in s["title"].lower()]
    if len(matches) == 1:
        return matches[0]["slug"]
    names = ", ".join(s["slug"] for s in (matches or stories))
    raise StoryError(f"{'Several' if matches else 'No'} stories match {ref!r}. Choose one of: {names}")


def workspace_url(slug: str, *, mode: str = "stories", day: str | None = None, source: str = "site") -> str:
    key = "site" if source == "site" else "place"
    url = f"/workspace?mode={mode}&{key}={slug}"
    return url + (f"&date={day}" if day else "")


def _site_detail(slug: str) -> dict | None:
    site = Site.query.filter_by(slug=slug).first()
    return site.to_dict(detail=True) if site else None


def _not_visible() -> list[dict]:
    return [
        {k: s.get(k) for k in ("slug", "name", "region", "kind", "reason")}
        for s in landchange().get("sites", [])
        if s.get("status") == "not_visible"
    ]


# ─── stories ──────────────────────────────────────────────

def _site_pictures() -> dict[str, dict]:
    """Per study-site slug: its name and its newest pass that has an image."""
    out: dict[str, dict] = {}
    rows = (
        db.session.query(Site.slug, Site.name, Scene.acquired_on, Scene.image)
        .outerjoin(Scene, (Scene.site_id == Site.id) & Scene.image.isnot(None))
        .order_by(Scene.acquired_on)
    )
    for slug, name, day, image in rows:
        out[slug] = {
            "name": name,
            "thumb_url": f"/api/scenes/{image}" if image else None,
            "thumb_date": day.isoformat() if day else None,
        }
    return out


def _land_picture(slug: str) -> dict:
    """A gallery place's name and its suggested "after" pass (else its last)."""
    land = _land_site(slug) or {}
    passes = [p for p in land.get("passes") or [] if p.get("image")]
    after = (land.get("suggested") or [None, None])[1]
    shown = next((p for p in passes if p["date"] == after), passes[-1] if passes else None)
    return {
        "name": land.get("name"),
        "thumb_url": f"/api/scenes/{shown['image']}" if shown else None,
        "thumb_date": shown["date"] if shown else None,
    }


def _theme_label(theme: str | None) -> str | None:
    return next((t["label"] for t in content().get("themes", []) if t["id"] == theme), None)


def _summary(story: dict, sites: dict[str, dict] | None = None) -> dict:
    """A story's list entry. ``name``, ``thumb_url`` and ``thumb_date`` are the
    place and one of its own NISAR pass images, to recognise it by.

    ``date`` is the pass the story is about (an auto story's later pass, a
    gallery story's suggested "after" pass, a study site's newest pass), which
    the feed sorts and filters on.
    """
    out = {k: story.get(k) for k in ("slug", "source", "theme", "title", "question")}
    out["origin"] = story.get("origin") or "curated"
    out["theme_label"] = _theme_label(story.get("theme"))
    out["hypotheses"] = len(story.get("hypotheses") or [])
    out["workspace_url"] = workspace_url(story["slug"], source=story["source"])
    if story["source"] == "site":
        picture = (sites if sites is not None else _site_pictures()).get(story["slug"])
    else:
        picture = _land_picture(story["slug"])
    out.update(picture or {"name": None, "thumb_url": None, "thumb_date": None})
    out["date"] = (story.get("period") or {}).get("end") or out.get("thumb_date")
    if out["origin"] == "auto":
        out["status_label"] = auto.STATUS_LABEL
        out.update({k: story.get(k) for k in ("detected_at", "updated_at", "period", "event", "detector", "kind")})
    return out


ORIGINS = ("curated", "auto")
SORTS = ("default", "newest")


def _as_day(value, name: str) -> str | None:
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value)).isoformat()
    except ValueError:
        raise StoryError(f"{name} must be a date (YYYY-MM-DD)") from None


def _filtered(theme=None, since=None, until=None, origin=None, sort="default") -> list[dict]:
    since, until = _as_day(since, "since"), _as_day(until, "until")
    if since and until and since > until:
        raise StoryError("since must be on or before until")
    if origin not in (None, "", *ORIGINS):
        raise StoryError(f"origin must be one of {', '.join(ORIGINS)}")
    if sort not in (None, "", *SORTS):
        raise StoryError(f"sort must be one of {', '.join(SORTS)}")
    stories = [s for s in content()["stories"] if not theme or s.get("theme") == theme]
    if origin:
        stories = [s for s in stories if (s.get("origin") or "curated") == origin]
    sites = _site_pictures()
    rows = [_summary(s, sites) for s in stories]
    if since:
        rows = [r for r in rows if r["date"] and r["date"] >= since]
    if until:
        rows = [r for r in rows if r["date"] and r["date"] <= until]
    if sort == "newest":
        rows.sort(key=lambda r: (r["date"] or "", r.get("updated_at") or ""), reverse=True)
    return rows


def list_stories(theme: str | None = None, since: str | None = None, until: str | None = None,
                 origin: str | None = None, sort: str = "default") -> dict:
    """Stories, optionally filtered by theme, origin and the date of the passes they're about."""
    rows = _filtered(theme, since, until, origin, sort)
    return {
        "themes": content().get("themes", []),
        "stories": rows,
        "count": len(rows),
        "hypothesis_label": HYPOTHESIS_LABEL,
        "auto_label": auto.STATUS_LABEL,
    }


FEED_LIMIT = 100


def story_feed(theme: str | None = None, since: str | None = None, until: str | None = None,
               origin: str | None = None, limit=20, offset=0) -> dict:
    """Every story newest first (the "Latest" view), a page at a time."""
    try:
        limit, offset = int(limit), int(offset)
    except (TypeError, ValueError):
        raise StoryError("limit and offset must be integers") from None
    if not 1 <= limit <= FEED_LIMIT or offset < 0:
        raise StoryError(f"limit must be 1-{FEED_LIMIT} and offset 0 or more")
    rows = _filtered(theme, since, until, origin, "newest")
    page = rows[offset:offset + limit]
    return {
        "stories": page, "count": len(page), "total": len(rows), "offset": offset,
        "next_offset": offset + limit if offset + limit < len(rows) else None,
        "latest_detection": max((r.get("detected_at") or "" for r in rows), default="") or None,
        "themes": content().get("themes", []),
        "auto_label": auto.STATUS_LABEL,
    }


def _land_channels(passes: list[dict]) -> dict:
    """Which polarizations a gallery place's passes hold, counted from the data."""
    n = len(passes)
    hv = sum(1 for p in passes if "HV" in (p.get("polarizations") or ""))
    if hv == n:
        label = f"HH and HV on all {n} passes"
    elif hv == 0:
        label = f"HH only on all {n} passes; HV was not collected"
    else:
        label = f"HH on all {n} passes; HV on {hv} of them"
    return {"passes": n, "hv_passes": hv, "label": label}


def _moments_for(site: dict) -> tuple[dict, list[dict]]:
    chain = chains.get_site_chain(site)
    if not chain.get("available"):
        return chain, []
    keys = ("title", "caption", "start", "end", "focus", "display", "detail", "unit", "layer", "stat", "readings")
    return chain, [{k: m.get(k) for k in keys if m.get(k) is not None} | {"index": i}
                   for i, m in enumerate(chain.get("moments") or [])]


def get_story(slug: str) -> dict:
    story = _story(slug)
    out = dict(story)
    out["hypothesis_label"] = HYPOTHESIS_LABEL
    out["theme_label"] = _theme_label(story.get("theme"))
    if story["source"] == "site":
        site = _site_detail(slug)
        if site is None:
            raise StoryError(f"Study site {slug!r} isn't loaded; run `flask nisar load`.")
        chain, moments = _moments_for(site)
        radar = chain.get("radar") or {}
        out["site"] = {k: site.get(k) for k in (
            "id", "slug", "name", "change_type", "product", "frame", "bbox",
            "first_date", "last_date", "scene_count",
        )}
        out["saw"] = {
            "metric": radar.get("metric"), "label": radar.get("label"), "unit": radar.get("unit"),
            "summary": radar.get("summary"), "moments": moments,
            "footprint": chain.get("footprint"),
        }
        out["compare_with"] = [
            {k: d.get(k) for k in ("id", "label", "place", "summary", "note") if d.get(k)}
            for d in chain.get("drivers") or []
        ]
    else:
        land = _land_site(slug) or {}
        passes = land.get("passes") or []
        out["site"] = {
            "slug": slug, "name": land.get("name"), "region": land.get("region"),
            "kind": land.get("kind"), "bbox": land.get("bbox"), "frame": land.get("frame"),
            "first_date": passes[0]["date"] if passes else None,
            "last_date": passes[-1]["date"] if passes else None,
            "scene_count": len(passes),
            "pixel_m": land.get("pixel_m"),
            "channels": _land_channels(passes),
        }
        out["saw"] = {
            "headline": land.get("headline"), "story": land.get("story"),
            "look_for": land.get("look_for"), "suggested": land.get("suggested"),
            "status": land.get("status"), "sources": land.get("sources") or [],
        }
        out["compare_with"] = []
    if story.get("origin") == "auto":
        out["status_label"] = auto.STATUS_LABEL
    out["workspace_url"] = workspace_url(slug, source=story["source"])
    return out


# ─── findings ─────────────────────────────────────────────

def _days(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def footprint_note(footprint: dict | None) -> str | None:
    """How open water is compared, in one sentence, or None."""
    if not footprint:
        return None
    if footprint.get("status") == "insufficient":
        return (f"The passes share only {footprint['pct_of_box']}% of the box, under the "
                f"{footprint['min_pct']}% needed, so open water is not compared between them.")
    text = f"Open water is compared over the {footprint['pct_of_box']}% of the box every pass imaged"
    estimated = footprint.get("estimated") or []
    if footprint.get("method") == "image" and estimated:
        n = len(estimated)
        text += (f"; for the {n} {'pass' if n == 1 else 'passes'} that imaged more, that share is "
                 f"estimated from the scene images to within about ±{footprint['uncertainty_pp']} points")
    return text + "."


def _confidence(passes: list[dict], record: list[dict], footprint: dict | None = None) -> dict:
    dates = [p["date"] for p in passes]
    gaps = [_days(a, b) for a, b in zip(dates, dates[1:])]
    provisional = sum(1 for p in passes if (p.get("quality") or "provisional") != "validated")
    partial = [p["date"] for p in passes
               if p.get("valid_pct") is not None and p["valid_pct"] < FULL_COVERAGE]
    modes = sorted({p["mode"] for p in passes if p.get("mode")})
    notes = []
    if provisional:
        notes.append(f"{provisional} of {len(passes)} passes are provisional, early-mission products.")
    if partial:
        saw = "pass imaged" if len(partial) == 1 else "passes imaged"
        notes.append(f"{len(partial)} {saw} under {FULL_COVERAGE}% of the box: {', '.join(partial)}.")
    shared = footprint_note(footprint)
    if shared:
        notes.append(shared)
    if len(modes) > 1:
        notes.append(f"These passes were collected in {len(modes)} acquisition modes ({', '.join(modes)}); "
                     "a difference between modes can look like change.")
    if gaps and max(gaps) > 24:
        notes.append(f"The longest gap between passes is {max(gaps)} days, so change between them is unseen.")
    if len(passes) == 1:
        notes.append("A single pass: a reading, not a change.")
    record_days = _days(record[0]["date"], record[-1]["date"]) if len(record) > 1 else 0
    if record_days < 366:
        notes.append(f"The whole record spans {record_days} days, under one year: no year-to-year comparison.")
    return {
        "passes": len(passes), "provisional": provisional, "partial_coverage": partial,
        "modes": modes, "longest_gap_days": max(gaps) if gaps else None, "record_days": record_days,
        "notes": notes,
    }


def _links(slug: str, source: str, moment: int | None) -> dict:
    args = {"story": slug} | ({"moment": moment} if moment is not None else {})
    query = f"?moment={moment}" if moment is not None else ""
    links = {
        "workspace": f"/workspace?mode=stories&finding={slug}" + (f":{moment}" if moment is not None else ""),
        "api": f"/api/findings/{slug}{query}",
        "mcp": {"tool": "build_finding", "arguments": args},
    }
    if source == "site":
        links["csv"] = f"/api/stories/{slug}/series.csv"
    return links


def build_finding(slug: str, moment: int | None = None) -> dict:
    """One moment of a story as a shareable, reproducible card."""
    story = _story(slug)
    today = date.today().isoformat()
    if story["source"] == "landchange":
        return _land_finding(story, today)

    site = _site_detail(slug)
    if site is None:
        raise StoryError(f"Study site {slug!r} isn't loaded; run `flask nisar load`.")
    chain, moments = _moments_for(site)
    if not moments:
        raise StoryError(f"{slug!r} has no moments to build a finding from.")
    index = story.get("hero_moment", 0) if moment is None else moment
    try:
        index = int(index)
    except (TypeError, ValueError):
        raise StoryError("moment must be an integer") from None
    if not 0 <= index < len(moments):
        raise StoryError(f"moment must be between 0 and {len(moments) - 1}")
    m = moments[index]
    radar = chain.get("radar") or {}
    raw = chain["moments"][index]
    metric = raw.get("metric") or radar.get("metric")
    observed = {}
    for o in site.get("observations") or []:
        observed.setdefault(o["metric"], {})[o["observed_on"]] = o["value"]
    values = observed.get(metric, {})
    visible = observed.get("water_visible_pct", {}) if metric == "water_pct" else {}
    scenes = site.get("scenes") or []
    in_window = [s for s in scenes if m["start"] <= s["date"] <= m["end"]]
    passes = [
        {"date": s["date"], "quality": s.get("quality"), "valid_pct": s.get("valid_pct"),
         "mode": s.get("mode"), "granule_id": s.get("granule_id"), "image_url": s.get("image_url"),
         "value": values.get(s["date"])}
        | ({"visible_value": visible.get(s["date"])} if visible else {})
        for s in in_window
    ]
    footprint = chain.get("footprint") if metric == "water_pct" else None
    # Only the hypotheses that address this moment: one written for another
    # stretch of the record must not be offered as an explanation of this one.
    hyps = [h for h in story.get("hypotheses") or [] if index in (h.get("moments") or [])]
    granules = [p["granule_id"] for p in passes if p.get("granule_id")]
    period = m["start"] if m["start"] == m["end"] else f"{m['start']} to {m['end']}"
    return {
        "id": f"{slug}/{index}",
        "story": {"slug": slug, "title": story["title"], "question": story["question"], "source": "site"},
        "site": {k: site.get(k) for k in ("slug", "name", "product", "frame", "bbox")},
        "claim": {
            "headline": f"{m.get('display')}: {m.get('caption')}",
            "title": m.get("title"), "display": m.get("display"), "detail": m.get("detail"),
            "caption": m.get("caption"), "start": m["start"], "end": m["end"], "focus": m.get("focus"),
            "metric": metric,
            "label": chains.SITE_CHAINS[slug]["moments"][index].get("label") or METRICS[metric]["label"],
            "unit": METRICS[metric]["unit"],
            "layer": m.get("layer"), "measured": True,
        },
        "moments": [{"index": x["index"], "title": x.get("title"), "display": x.get("display")} for x in moments],
        "moment": index,
        "evidence": {"passes": passes, "record_passes": len(scenes), "footprint": footprint},
        "confidence": _confidence(passes or in_window, scenes, footprint),
        "hypotheses": hyps,
        "hypothesis_label": HYPOTHESIS_LABEL,
        "compare_with": [
            {k: d.get(k) for k in ("label", "place", "summary", "note") if d.get(k)}
            for d in chain.get("drivers") or []
        ],
        "comparison_note": "Shown for comparison. Lining up in time doesn't show that one affects the other.",
        "cant_see": story.get("cant_see") or [],
        "next": story.get("next"),
        "links": _links(slug, "site", index),
        "citation": (
            f"NISAR Surface Change Explorer, finding {slug}/{index} ({period}). "
            f"Derived from NASA/ISRO NISAR L2 {site.get('product')} granules"
            f"{' on frame ' + site['frame'] if site.get('frame') else ''}"
            f"{' (' + str(len(granules)) + ' passes)' if granules else ''}, distributed by ASF DAAC. "
            f"Accessed {today}."
        ),
        "caveat": CAVEAT,
    }


def _land_finding(story: dict, today: str) -> dict:
    slug = story["slug"]
    land = _land_site(slug) or {}
    all_passes = land.get("passes") or []
    if not all_passes:
        raise StoryError(f"No passes for {slug!r}.")
    start, end = (land.get("suggested") or [all_passes[0]["date"], all_passes[-1]["date"]])[:2]
    window = [p for p in all_passes if start <= p["date"] <= end]
    passes = [
        {"date": p["date"], "quality": p.get("quality"), "valid_pct": p.get("valid_pct"),
         "polarizations": p.get("polarizations"),
         "image_url": f"/api/scenes/{p['image']}" if p.get("image") else None}
        for p in window
    ]
    status = {"visible": "Visible in the images", "likely": "Likely, not confirmed",
              auto.STATUS: auto.STATUS_LABEL}.get(land.get("status"), land.get("status"))
    is_auto = story.get("origin") == "auto"
    claim = {
        "headline": f"{land.get('headline')} ({status})",
        "title": land.get("headline"), "display": status, "detail": land.get("look_for"),
        "caption": land.get("look_for"), "start": start, "end": end, "measured": False,
    }
    if is_auto:
        # An auto story's text is its measurement, so the claim is measured.
        claim.update({"headline": f"{story['summary']} ({status})", "detail": story["summary"],
                      "caption": story["summary"], "measured": True,
                      "metric": (story.get("detection") or {}).get("metric")})
    evidence = {"passes": passes, "record_passes": len(all_passes), "sources": land.get("sources") or []}
    if is_auto:
        evidence["detection"] = story.get("detection")
    return {
        "id": f"{slug}/0",
        "story": {"slug": slug, "title": story["title"], "question": story["question"], "source": "landchange",
                  "origin": story.get("origin") or "curated"},
        "site": {"slug": slug, "name": land.get("name"), "product": "GCOV", "frame": land.get("frame"),
                 "bbox": land.get("bbox"), "channels": _land_channels(all_passes)["label"]},
        "claim": claim,
        "moments": [],
        "moment": None,
        "evidence": evidence,
        "confidence": _confidence(passes, all_passes),
        "hypotheses": story.get("hypotheses") or [],
        "hypothesis_label": HYPOTHESIS_LABEL,
        "compare_with": [],
        "comparison_note": None,
        "cant_see": story.get("cant_see") or [],
        "next": story.get("next"),
        "links": _links(slug, "landchange", None),
        "citation": (
            f"NISAR Surface Change Explorer, finding {slug}/0 ({start} to {end}). Derived from NASA/ISRO "
            f"NISAR L2 GCOV granules{' on frame ' + land['frame'] if land.get('frame') else ''}, "
            f"distributed by ASF DAAC. Accessed {today}."
        ),
        "caveat": CAVEAT,
    }


# ─── CSV export ───────────────────────────────────────────

CSV_COLUMNS = ["site", "date", "metric", "value", "unit", "basis", "quality", "valid_pct",
               "acquisition_mode", "granule_id"]


def _basis(metric: str, footprint: dict | None, day: str) -> str:
    """What each value is computed over, so a CSV row stands on its own."""
    if metric == "water_pct" and footprint:
        text = f"shared footprint: {footprint['pct_of_box']}% of the box, imaged by all {footprint['passes']} passes"
        if footprint.get("method") == "image" and day in (footprint.get("estimated") or []):
            text += f"; estimated from the scene image, about ±{footprint['uncertainty_pp']} points"
        return text
    if metric == "los_mm":
        return "point at the site, relative to the reference point"
    if metric == "coherence":
        return "point at the site"
    return "pixels this pass imaged in the box"


def series_csv(slug: str) -> str:
    """Every NISAR value at a study site, one row per pass and metric."""
    site = Site.query.filter_by(slug=slug).first()
    if site is None:
        raise StoryError(f"No study site {slug!r}.")
    d = site.to_dict(detail=True)
    scenes = {s["date"]: s for s in d.get("scenes") or []}
    footprint = d.get("footprint")
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    rows = sorted(d.get("observations") or [], key=lambda o: (o["observed_on"], o["metric"]))
    for o in rows:
        sc = scenes.get(o["observed_on"], {})
        writer.writerow([
            slug, o["observed_on"], o["metric"], round(o["value"], 4), o["unit"],
            _basis(o["metric"], footprint, o["observed_on"]),
            sc.get("quality") or "", sc.get("valid_pct") if sc.get("valid_pct") is not None else "",
            sc.get("mode") or "", o.get("granule_id") or sc.get("granule_id") or "",
        ])
    return out.getvalue()


# ─── coverage check (Investigate) ─────────────────────────

def _verdict(product: str, n: int, revisit: float | None) -> str:
    if n == 0:
        return "No passes in this window."
    if product == "GCOV":
        if n >= 8 and revisit and revisit <= 24:
            return "Enough passes to chart a seasonal series of backscatter (crops, floods, wetlands)."
        return "Some passes: enough for before/after images, thin for a series."
    if product == "GUNW":
        if n >= 6:
            return "Enough interferograms to try a ground-motion series (needs a stable reference point)."
        return "Few interferograms: a single change, not a pace."
    if product == "GOFF":
        return "Offsets measure fast motion (glaciers, large landslides). This app lists them for download only."
    return "Soil-moisture scenes available: soil wetness at each pass where vegetation is light."


def coverage_check(bbox: list[float], start: date, end: date) -> dict:
    """Which NISAR products cover a box, how often, on which tracks, at what quality."""
    products = []
    for product in COVERAGE_PRODUCTS:
        try:
            found = nisar.search_granules(bbox, start, end, product=product, limit=nisar.MAX_RESULTS)
        except nisar.NisarSearchError as exc:
            products.append({"product": product, "error": str(exc)})
            continue
        granules = found.get("granules") or []
        days = sorted({(g.get("start") or "")[:10] for g in granules if g.get("start")})
        gaps = [_days(a, b) for a, b in zip(days, days[1:]) if _days(a, b) > 0]
        by_frame: dict[str, set] = {}
        for g in granules:
            m = _FRAME_RE.search(g.get("title") or "")
            if m and g.get("start"):
                by_frame.setdefault("_".join(m.groups()), set()).add(g["start"][:10])
        frames = []
        for key, dset in by_frame.items():
            fd = sorted(dset)
            fgaps = [_days(a, b) for a, b in zip(fd, fd[1:]) if _days(a, b) > 0]
            frames.append({"frame": key, "pass_dates": len(fd),
                           "median_revisit_days": round(median(fgaps), 1) if fgaps else None})
        frames.sort(key=lambda f: -f["pass_dates"])
        best = frames[0] if frames else None
        quality: dict[str, int] = {}
        for g in granules:
            quality[g.get("quality") or "unknown"] = quality.get(g.get("quality") or "unknown", 0) + 1
        revisit = round(median(gaps), 1) if gaps else None  # any frame
        products.append({
            "product": product,
            "label": nisar.PRODUCTS[product].get("label"),
            "hits": found.get("hits", len(granules)),
            "sampled": len(granules),
            "pass_dates": len(days),
            "first": days[0] if days else None,
            "last": days[-1] if days else None,
            "median_revisit_days": revisit,
            "frames": frames,
            "best_frame": best["frame"] if best else None,
            "quality": quality,
            "verdict": _verdict(product, best["pass_dates"] if best else len(days),
                                best["median_revisit_days"] if best else revisit),
        })
    usable = [p["product"] for p in products if p.get("pass_dates")]
    return {
        "bbox": bbox, "start": start.isoformat(), "end": end.isoformat(),
        "products": products,
        "summary": (
            f"NISAR has {', '.join(usable)} passes here." if usable
            else "No NISAR passes found here in this window."
        ),
        "note": "Counts come from NASA's catalog (CMR); up to 200 granules are sampled per product. "
                "median_revisit_days mixes every track; each frame's own revisit (usually 12 days) is what a "
                "clean series uses, and verdicts are based on the frame with most passes.",
    }


def default_window(start: date | None, end: date | None) -> tuple[date, date]:
    end = end or date.today()
    start = start or end - timedelta(days=365)
    if start > end:
        raise StoryError("start must be on or before end")
    if (end - start).days > 800:
        raise StoryError("Keep the window under about two years.")
    return start, end


def landchange_not_visible() -> list[dict]:
    return _not_visible()


__all__ = [
    "StoryError", "list_stories", "get_story", "build_finding", "series_csv",
    "coverage_check", "default_window", "resolve_story_slug", "landchange_not_visible", "story_feed",
]
