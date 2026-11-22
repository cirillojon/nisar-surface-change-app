"""Incremental ingest: render only the passes a target hasn't seen yet.

For each target: search NASA CMR for GCOV granules over its centre, keep one
track/frame (the one with most pass dates, then pinned so images line up),
skip granules already processed (``state.json``), and render the newest few
into the same images the gallery uses (``app/data/scenes/auto/<slug>/``):
an RGB ``.webp`` and the half-resolution 8-bit HH ``.hh.png`` change maps and
the patch detector read. Each pass also gets one number per metric
(``pipeline.render.box_stats``) for the step and trend detectors.

NASA keeps NISAR granules permanently, so everything here can be rebuilt by
deleting a target's state and images and running again.
"""
from __future__ import annotations

import logging
from concurrent.futures import ProcessPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path

from app import nisar
from app.nisar_render import encode_webp
from pipeline.render import best_frame, box_stats, frame_of, grid, hh_png, mode_of, render_pass

log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[1]
SCENES_DIR = ROOT / "app" / "data" / "scenes"
IMAGE_PREFIX = "auto"
AUTO_MAX_PX = 300          # smaller than the gallery's 450: ~25-40 KB per pass
SEARCH_PAD_DEG = 0.01
MAX_PASSES_PER_TARGET = 12  # per run; the rest are picked up on later runs
# A skipped pass is not retried when the reason is about the data, only when
# it was a failure (network, auth) that may pass.
PERMANENT_SKIPS = ("only ", "outside the image")


def place_for(target: dict, existing: dict | None, frame: str | None) -> dict:
    """The place record for a target (its passes kept from ``existing``)."""
    _, bbox, px = grid(target["lon"], target["lat"], target["half_km"], target.get("max_px", AUTO_MAX_PX))
    place = {
        "slug": target["slug"], "name": target["name"], "region": target.get("region"),
        "kind": target["kind"], "theme": target["theme"], "status": "watching",
        "lon": target["lon"], "lat": target["lat"],
        "bbox": [round(v, 5) for v in bbox], "pixel_m": round(px), "frame": frame,
        "story": target.get("note") or "Watched for change by NISAR Watch.",
        "look_for": "The change map between the story's two passes (in the Layer menu).",
        "sources": list(target.get("sources") or []),
        "watch": {"origin": target["origin"], "event": target.get("event")},
        "passes": list((existing or {}).get("passes") or []),
    }
    ev = target.get("event")
    if ev and ev.get("url") and not any(s.get("url") == ev["url"] for s in place["sources"]):
        place["sources"].append({"label": f"{ev['source']}: {ev['title']}", "url": ev["url"]})
    return place


def plan(target: dict, entry: dict, *, max_passes: int, search=None) -> tuple[str | None, list[dict], int]:
    """``(frame, granules to render, granules on the frame)`` for one target."""
    search = search or nisar.search_all_granules
    d = SEARCH_PAD_DEG
    start = date.fromisoformat(target["start"]) if target.get("start") else None
    granules = search("GCOV", bbox=[target["lon"] - d, target["lat"] - d, target["lon"] + d, target["lat"] + d],
                      start=start, end=None)
    pinned = target.get("frame") or entry.get("frame")
    if pinned:
        granules = [g for g in granules if frame_of(g["title"]) == pinned]
    frame, passes = best_frame(granules, pinned)
    done = entry.get("processed") or {}
    todo = [g for g in passes if g["title"] not in done]
    # Newest first: a new pass matters more than backfilling an old one.
    return frame, todo[-max_passes:] if max_passes else [], len(passes)


def ingest(targets: list[dict], state: dict, places: dict[str, dict], *, max_total: int,
           max_per_target: int = MAX_PASSES_PER_TARGET, workers: int = 4, dry_run: bool = False,
           search=None, render=render_pass, scenes_dir: Path = SCENES_DIR) -> dict:
    """Fetch new passes for every target; updates ``state`` and ``places`` in place.

    Returns a report: per target the frame, passes found, rendered, skipped
    (with reasons) and errors.
    """
    report: dict[str, dict] = {}
    jobs, budget = [], max_total
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for t in targets:
        entry = state.setdefault("targets", {}).setdefault(t["slug"], {})
        try:
            frame, todo, total = plan(t, entry, max_passes=min(max_per_target, budget), search=search)
        except Exception as exc:  # noqa: BLE001 - one target's failure doesn't stop the run
            report[t["slug"]] = {"error": f"search failed: {exc}"[:200]}
            continue
        entry["last_checked"] = now
        if frame:
            entry["frame"] = frame
        places[t["slug"]] = place_for(t, places.get(t["slug"]), entry.get("frame"))
        report[t["slug"]] = {"frame": frame, "on_frame": total, "planned": len(todo), "rendered": [], "skipped": []}
        budget -= len(todo)
        jobs += [(t["slug"], g, t["lon"], t["lat"], t["half_km"], t.get("max_px", AUTO_MAX_PX)) for g in todo]
    if dry_run or not jobs:
        return report

    if workers > 1:
        with ProcessPoolExecutor(workers) as pool:
            results = list(pool.map(render, jobs))
    else:
        results = [render(j) for j in jobs]

    for slug, g, data, note in results:
        day = g["start"][:10]
        processed = state["targets"][slug].setdefault("processed", {})
        if data is None:
            report[slug]["skipped"].append(f"{day}: {note}")
            if note.startswith(PERMANENT_SKIPS):
                processed[g["title"]] = f"skipped: {note}"
            continue
        rgb, db, valid, pols, hv_db = data
        folder = scenes_dir / IMAGE_PREFIX / slug
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{day}.webp").write_bytes(encode_webp(rgb, valid))
        hh_png(db, valid).save(folder / f"{day}.hh.png", optimize=True)
        place = places[slug]
        place["passes"] = [p for p in place["passes"] if p["date"] != day] + [{
            "date": day, "quality": g.get("quality"), "polarizations": pols,
            "valid_pct": round(float(valid.mean()) * 100, 1), "mode": mode_of(g["title"]),
            "granule": g["title"],
            "image": f"{IMAGE_PREFIX}/{slug}/{day}.webp", "hh": f"{IMAGE_PREFIX}/{slug}/{day}.hh.png",
            "stats": box_stats(db, valid, hv_db),
        }]
        place["passes"].sort(key=lambda p: p["date"])
        processed[g["title"]] = "ok"
        report[slug]["rendered"].append(day)
    return report


def prune(places: dict[str, dict], state: dict, keep: set[str], scenes_dir: Path = SCENES_DIR) -> list[str]:
    """Forget expired event places that never got a story, and their images."""
    gone = []
    for slug in list(places):
        if slug in keep or places[slug]["watch"]["origin"] != "event":
            continue
        folder = scenes_dir / IMAGE_PREFIX / slug
        for f in folder.glob("*"):
            f.unlink()
        if folder.is_dir():
            folder.rmdir()
        places.pop(slug)
        state.get("targets", {}).pop(slug, None)
        gone.append(slug)
    return gone

