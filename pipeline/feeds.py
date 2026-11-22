"""Event feeds: where in the world something is happening that radar could see.

Each feed is normalised to the same event record::

    {"id", "source", "kind", "title", "date", "lon", "lat", "url", "magnitude"?}

``kind`` is one of the land-change kinds the app already uses (Earthquake,
Volcano, Flood, Landslide, Wildfire, Glacier). Feed titles are shown as
"Reported:" context next to a story, never as the cause of a measured change.

Sources (all free, no key):
* NASA EONET v3: https://eonet.gsfc.nasa.gov/docs/v3
* USGS earthquake feeds: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
* GDACS: https://www.gdacs.org/ (event list API)
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

import requests

log = logging.getLogger(__name__)

EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events"
USGS_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson"
GDACS_URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"

EONET_KINDS = {"volcanoes": "Volcano", "floods": "Flood", "landslides": "Landslide",
               "wildfires": "Wildfire", "seaLakeIce": "Glacier", "earthquakes": "Earthquake"}
GDACS_KINDS = {"FL": "Flood", "VO": "Volcano", "EQ": "Earthquake", "WF": "Wildfire"}
MIN_MAGNITUDE = 6.0
MAX_DEPTH_KM = 70       # deeper quakes rarely move the surface enough to see
TIMEOUT = 30


def _day(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):  # USGS: ms since epoch
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).date().isoformat()
    return str(value)[:10]


def parse_eonet(payload: dict) -> list[dict]:
    out = []
    for ev in payload.get("events") or []:
        kinds = [EONET_KINDS[c.get("id")] for c in ev.get("categories") or [] if c.get("id") in EONET_KINDS]
        points = [g for g in ev.get("geometry") or [] if g.get("type") == "Point"]
        if not kinds or not points:
            continue
        # Many EONET events (wildfires, ice) move; the latest position is the one to watch.
        g = max(points, key=lambda g: g.get("date") or "")
        lon, lat = g["coordinates"][:2]
        first = min(p.get("date") or "" for p in points)
        src = (ev.get("sources") or [{}])[0]
        out.append({"id": f"eonet:{ev['id']}", "source": "NASA EONET", "kind": kinds[0],
                    "title": ev.get("title") or kinds[0], "date": _day(first),
                    "lon": float(lon), "lat": float(lat),
                    "url": src.get("url") or ev.get("link"), "magnitude": g.get("magnitudeValue")})
    return out


def parse_usgs(payload: dict, min_magnitude: float = MIN_MAGNITUDE) -> list[dict]:
    out = []
    for f in payload.get("features") or []:
        p = f.get("properties") or {}
        lon, lat, *rest = (f.get("geometry") or {}).get("coordinates") or [None, None]
        depth = rest[0] if rest else None
        if lon is None or (p.get("mag") or 0) < min_magnitude:
            continue
        if depth is not None and depth > MAX_DEPTH_KM:
            continue
        out.append({"id": f"usgs:{f.get('id')}", "source": "USGS", "kind": "Earthquake",
                    "title": p.get("title") or f"M{p.get('mag')} earthquake",
                    "date": _day(p.get("time")), "lon": float(lon), "lat": float(lat),
                    "url": p.get("url"), "magnitude": p.get("mag")})
    return out


def parse_gdacs(payload: dict) -> list[dict]:
    out = []
    for f in payload.get("features") or []:
        p = f.get("properties") or {}
        kind = GDACS_KINDS.get(p.get("eventtype"))
        coords = (f.get("geometry") or {}).get("coordinates")
        if not kind or not coords or (f.get("geometry") or {}).get("type") != "Point":
            continue
        url = p.get("url")
        if isinstance(url, dict):
            url = url.get("report") or url.get("details")
        title = p.get("name") or p.get("htmldescription") or kind
        out.append({"id": f"gdacs:{p.get('eventtype')}{p.get('eventid')}", "source": "GDACS", "kind": kind,
                    "title": title, "date": _day(p.get("fromdate")),
                    "lon": float(coords[0]), "lat": float(coords[1]), "url": url,
                    "magnitude": (p.get("severitydata") or {}).get("severity"),
                    "alert": p.get("alertlevel")})
    return out


def _get(url, params=None):
    r = requests.get(url, params=params, timeout=TIMEOUT, headers={"Accept": "application/json"})
    r.raise_for_status()
    return r.json()


def fetch_events(days: int = 30, today: date | None = None) -> tuple[list[dict], list[str]]:
    """Events from every feed over the last ``days``, plus any feed errors.

    One feed failing never stops the others (or the run).
    """
    today = today or datetime.now(timezone.utc).date()
    since = today - timedelta(days=days)
    events, errors = [], []
    jobs = [
        ("NASA EONET", lambda: parse_eonet(_get(EONET_URL, {"status": "all", "days": days}))),
        ("USGS", lambda: parse_usgs(_get(USGS_URL))),
        ("GDACS", lambda: parse_gdacs(_get(GDACS_URL, {
            "eventlist": ",".join(GDACS_KINDS), "alertlevel": "Orange;Red",
            "fromdate": since.isoformat(), "todate": today.isoformat()}))),
    ]
    for name, job in jobs:
        try:
            got = job()
            log.info("%s: %d events", name, len(got))
            events += got
        except Exception as exc:  # noqa: BLE001 - a feed outage is reported, not fatal
            errors.append(f"{name}: {exc}")
            log.warning("%s feed failed: %s", name, exc)
    return [e for e in events if e["date"] and e["date"] >= since.isoformat()], errors
