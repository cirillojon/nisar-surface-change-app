"""Targets: the places the watch job looks at on each run.

Two kinds:

* **watchlist** – ``app/data/watchlist.json``, curated by people. Kept for good.
* **event** – made from an event feed record (``pipeline.feeds``), with a window
  sized by the kind of event, a start date some weeks before the event (so
  there are passes from before), and an expiry. Kept in ``state.json``.

Curated gallery places and study sites are *not* on the watchlist: their
captions are checked against their data by the tests, so they are refreshed by
the opt-in ``nisar-curated-refresh`` workflow, whose PR people review.
"""
from __future__ import annotations

import json
import math
import re
import unicodedata
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WATCHLIST_PATH = ROOT / "app" / "data" / "watchlist.json"

THEMES = {"Earthquake": "ground", "Volcano": "ground", "Landslide": "ground", "Subsidence": "ground",
          "Construction": "ground", "Flood": "water", "River": "water", "Lake": "water", "Wetland": "water",
          "Wildfire": "forest", "Forest": "forest", "Glacier": "ice", "Ice": "ice", "Crops": "food"}
# Window half-width (km) per kind of event: big enough to hold the event, small
# enough that a change patch is many pixels.
EVENT_HALF_KM = {"Earthquake": 15, "Volcano": 6, "Flood": 20, "Landslide": 5, "Wildfire": 10, "Glacier": 15}
EVENT_LOOKBACK_DAYS = 48   # four 12-day repeats before the event
EVENT_TTL_DAYS = 60
MAX_NEW_EVENTS = 5         # per run
MAX_EVENT_TARGETS = 20     # alive at once


PREFIX = "auto-"  # keeps auto slugs apart from curated places and stories


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48].strip("-")


def window(t: dict) -> list[float]:
    """``[west, south, east, north]`` of a target's square window."""
    dlon = t["half_km"] / (111.32 * math.cos(math.radians(t["lat"])))
    dlat = t["half_km"] / 110.57
    return [t["lon"] - dlon, t["lat"] - dlat, t["lon"] + dlon, t["lat"] + dlat]


def overlaps(a: dict, b: dict) -> bool:
    wa, wb = window(a), window(b)
    return wa[0] < wb[2] and wb[0] < wa[2] and wa[1] < wb[3] and wb[1] < wa[3]


def load_watchlist(path: Path | None = None) -> list[dict]:
    data = json.loads((path or WATCHLIST_PATH).read_text(encoding="utf-8"))
    out = []
    for t in data["targets"]:
        out.append({**t, "slug": PREFIX + t["slug"], "origin": "watchlist",
                    "theme": t.get("theme") or THEMES.get(t["kind"], "ground")})
    return out


def event_target(ev: dict) -> dict | None:
    half = EVENT_HALF_KM.get(ev["kind"])
    if half is None or not ev.get("date"):
        return None
    when = date.fromisoformat(ev["date"])
    return {
        "slug": PREFIX + slugify(f"{ev['kind']} {ev['title']} {ev['date'][:7]}"),
        "name": ev["title"], "region": None, "kind": ev["kind"], "theme": THEMES.get(ev["kind"], "ground"),
        "lon": round(ev["lon"], 4), "lat": round(ev["lat"], 4), "half_km": half,
        "start": (when - timedelta(days=EVENT_LOOKBACK_DAYS)).isoformat(),
        "expires": (when + timedelta(days=EVENT_TTL_DAYS)).isoformat(),
        "origin": "event",
        "event": {k: ev.get(k) for k in ("id", "source", "title", "date", "url", "magnitude")},
    }


def merge_events(watch: list[dict], known: list[dict], events: list[dict], today: date) -> tuple[list[dict], list[dict]]:
    """Event targets to keep after this run's events, and what was skipped (with why).

    ``known`` are event targets from earlier runs. Expired ones are dropped
    (their place and any story stay; they just stop being watched). New events
    are skipped when they fall in a window already watched, or past the caps.
    """
    alive = [t for t in known if t.get("expires", "9999") >= today.isoformat()]
    seen_ids = {t["event"]["id"] for t in known}
    skipped, added = [], 0
    for ev in sorted(events, key=lambda e: e["date"], reverse=True):
        if ev["id"] in seen_ids:
            continue
        t = event_target(ev)
        if t is None:
            skipped.append({"event": ev["title"], "why": f"{ev['kind']} events aren't watched"})
            continue
        if t["expires"] < today.isoformat():
            continue
        hit = next((w for w in watch + alive if overlaps(t, w)), None)
        if hit:
            skipped.append({"event": ev["title"], "why": f"already watched as {hit['slug']}"})
            continue
        if added >= MAX_NEW_EVENTS or len(alive) >= MAX_EVENT_TARGETS:
            skipped.append({"event": ev["title"], "why": "over the per-run event cap"})
            continue
        alive.append(t)
        seen_ids.add(ev["id"])
        added += 1
    return alive, skipped
