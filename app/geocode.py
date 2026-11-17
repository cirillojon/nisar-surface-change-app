"""Find a place by name, so a viewer can fly the map there.

Uses OpenStreetMap's Nominatim (no key). Its usage policy asks for an
identifying User-Agent, at most one request a second, cached results and no
search-as-you-type, so the app searches only when the viewer submits, and
this module throttles and caches every lookup. Set ``GEOCODER_URL`` to use
another Nominatim-compatible server (for example a self-hosted one).

A result is ``{"name", "label", "kind", "latitude", "longitude", "bbox"}``,
``bbox`` being ``[min_lon, min_lat, max_lon, max_lat]``.
"""
from __future__ import annotations

import os
import re
import threading
import time

import requests

DEFAULT_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "nisar-surface-change-explorer"
TIMEOUT_SECONDS = 10
MAX_RESULTS = 6
MIN_QUERY, MAX_QUERY = 2, 120

ATTRIBUTION = {
    "text": "© OpenStreetMap contributors",
    "url": "https://www.openstreetmap.org/copyright",
}

# Nominatim allows one request a second, from the whole app.
_MIN_INTERVAL_SECONDS = 1.0
_CACHE_TTL_SECONDS = 24 * 3600
_CACHE_MAX_ENTRIES = 512
_cache: dict[str, tuple[float, list]] = {}
_cache_lock = threading.Lock()
_throttle_lock = threading.Lock()
_last_request = 0.0


def clean_query(value) -> str:
    """The query trimmed and with runs of spaces collapsed; ValueError if unusable."""
    query = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(query) < MIN_QUERY:
        raise ValueError("Type at least two letters of a place name.")
    if len(query) > MAX_QUERY:
        raise ValueError(f"A place name can be at most {MAX_QUERY} characters.")
    return query


def _wait_turn():
    global _last_request
    with _throttle_lock:
        wait = _last_request + _MIN_INTERVAL_SECONDS - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()


def _place(row) -> dict | None:
    """One Nominatim row as a result; None if it lacks a usable position."""
    try:
        lat, lon = float(row["lat"]), float(row["lon"])
        south, north, west, east = (float(v) for v in row["boundingbox"])
    except (KeyError, TypeError, ValueError):
        return None
    label = row.get("display_name") or ""
    name = row.get("name") or label.split(",")[0].strip()
    if not name:
        return None
    return {
        "name": name,
        "label": label,
        "kind": row.get("addresstype") or row.get("type") or "place",
        "latitude": lat,
        "longitude": lon,
        "bbox": [west, south, east, north],
    }


def search(query: str, session=None) -> list[dict]:
    """Places matching ``query`` (already cleaned), best first."""
    key = query.lower()
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
    _wait_turn()
    http = session or requests
    resp = http.get(
        os.environ.get("GEOCODER_URL") or DEFAULT_URL,
        params={"q": query, "format": "jsonv2", "limit": MAX_RESULTS, "accept-language": "en"},
        headers={"User-Agent": USER_AGENT},
        timeout=TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    rows = resp.json()
    places = [p for p in (_place(row) for row in rows if isinstance(row, dict)) if p] if isinstance(rows, list) else []
    with _cache_lock:
        if len(_cache) >= _CACHE_MAX_ENTRIES:
            # Drop the entry that expires first.
            _cache.pop(min(_cache, key=lambda k: _cache[k][0]))
        _cache[key] = (time.monotonic() + _CACHE_TTL_SECONDS, places)
    return places


def clear_cache():
    global _last_request
    with _cache_lock:
        _cache.clear()
    _last_request = 0.0
