"""Related series shown on the same dates as the NISAR passes.

They are context only; nothing here tests a link with the radar.

A driver is a daily series from a public source that needs no key:

  • ``rain``   — daily precipitation from ECMWF's IFS model, and seasonal
                 normals from the ERA5 reanalysis (Open-Meteo archive API)
  • ``river``  — GloFAS modelled river discharge (Open-Meteo flood API)
  • ``quakes`` — earthquakes per day inside a box (INGV FDSN event service)

Curated sites read a committed snapshot (``app/data/drivers.json``, written
by ``scripts/build_driver_data.py``), so the app runs without network
access. Drawn areas fetch rain live, cached for ten minutes.

A daily series is ``{"start": "YYYY-MM-DD", "values": [...]}`` with one
value per day (``None`` where the source has no data).
"""
from __future__ import annotations

import json
import threading
import time
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Optional

import requests

SNAPSHOT_PATH = Path(__file__).parent / "data" / "drivers.json"

RAIN_URL = "https://archive-api.open-meteo.com/v1/archive"
RIVER_URL = "https://flood-api.open-meteo.com/v1/flood"
QUAKES_URL = "https://webservices.ingv.it/fdsnws/event/1/query"
USER_AGENT = "nisar-surface-change"
TIMEOUT_SECONDS = 20

# Each pass is compared with what happened over one NISAR repeat cycle.
WINDOW_DAYS = 12
# Longest range a live request may ask for.
MAX_LIVE_DAYS = 1100

# The weather model is named in every request, so Open-Meteo's default
# (which changes model in 2017) can never mix two models in one series.
# Daily rain: ECMWF's operational model, 9 km, no delay, from 2017.
RAIN_MODEL = "ecmwf_ifs"
# Seasonal normals: ERA5 for the season and the baseline alike, the one
# record that is consistent across decades (about five days behind).
NORMAL_MODEL = "era5"
NORMAL_SOURCE = "ERA5"

KINDS = {
    "rain": {
        "label": "Rainfall",
        "unit": "mm",
        "aggregate": "sum",
        "chart": "bars",
        "source": {
            "name": "ECMWF IFS (9 km) via Open-Meteo",
            "url": "https://open-meteo.com/en/docs/historical-weather-api",
            "license": "CC BY 4.0",
        },
        "note": "A weather model's estimate for one grid cell, not a rain gauge.",
    },
    "river": {
        "label": "River flow",
        "unit": "m³/s",
        "aggregate": "mean",
        "chart": "area",
        "source": {
            "name": "GloFAS v4 via Open-Meteo",
            "url": "https://open-meteo.com/en/docs/flood-api",
            "license": "CC BY 4.0",
        },
        "note": "Modelled discharge for one river cell, not a gauge reading.",
    },
    "quakes": {
        "label": "Earthquakes",
        "unit": "quakes",
        "aggregate": "sum",
        "chart": "bars",
        "source": {
            "name": "INGV earthquake catalogue",
            "url": "https://terremoti.ingv.it/en",
            "license": "CC BY 4.0",
        },
        "note": "Every located event in the site's box, whatever its size.",
    },
}

_CACHE_TTL_SECONDS = 600
_CACHE_MAX_ENTRIES = 128
_cache: dict[tuple, tuple[float, dict]] = {}
_cache_lock = threading.Lock()


class SourceError(RuntimeError):
    """A source answered, but without usable data."""


# ─── Fetching ────────────────────────────────────────────────────────

def _open_meteo(url, variable, lat, lon, start, end, session, model=None):
    http = session or requests
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "daily": variable,
        "timezone": "UTC",
    }
    if model:
        params["models"] = model
    resp = http.get(
        url,
        params=params,
        headers={"User-Agent": USER_AGENT},
        timeout=TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    payload = resp.json()
    daily = payload.get("daily") or {}
    days, values = daily.get("time") or [], daily.get(variable) or []
    if not days or len(days) != len(values):
        raise SourceError(payload.get("reason") or f"No {variable} data returned")
    # The newest days are empty until the source catches up.
    while values and values[-1] is None:
        values = values[:-1]
    return {
        "latitude": payload.get("latitude"),
        "longitude": payload.get("longitude"),
        "start": days[0],
        "values": [None if v is None else round(float(v), 2) for v in values],
    }


def fetch_rain(lat, lon, start: date, end: date, *, model=RAIN_MODEL, session=None) -> dict:
    """Daily precipitation (mm) from one weather model at the cell nearest the point."""
    return _open_meteo(RAIN_URL, "precipitation_sum", lat, lon, start, end, session, model)


def fetch_river(lat, lon, start: date, end: date, *, session=None) -> dict:
    """Daily GloFAS river discharge (m³/s) at the river cell nearest the point."""
    return _open_meteo(RIVER_URL, "river_discharge", lat, lon, start, end, session)


def fetch_quakes(bbox, start: date, end: date, *, session=None) -> dict:
    """Earthquakes per day inside ``bbox``, plus the five largest."""
    min_lon, min_lat, max_lon, max_lat = bbox
    http = session or requests
    resp = http.get(
        QUAKES_URL,
        params={
            "starttime": start.isoformat(),
            "endtime": (end + timedelta(days=1)).isoformat(),
            "minlatitude": min_lat,
            "maxlatitude": max_lat,
            "minlongitude": min_lon,
            "maxlongitude": max_lon,
            "format": "text",
        },
        headers={"User-Agent": USER_AGENT},
        timeout=TIMEOUT_SECONDS,
    )
    # The service answers 204 with no body when the box is quiet.
    quiet = resp.status_code == 204
    if not quiet:
        resp.raise_for_status()
    counts = [0] * ((end - start).days + 1)
    events = []
    for line in [] if quiet else resp.text.splitlines():
        fields = line.split("|")
        if line.startswith("#") or len(fields) < 11:
            continue
        try:
            day = date.fromisoformat(fields[1][:10])
            magnitude = float(fields[10])
        except ValueError:
            continue
        offset = (day - start).days
        if 0 <= offset < len(counts):
            counts[offset] += 1
            events.append({"date": day.isoformat(), "magnitude": magnitude})
    events.sort(key=lambda e: (-e["magnitude"], e["date"]))
    return {"start": start.isoformat(), "values": counts, "largest": events[:5]}


def seasonal_normal(lat, lon, season, year, *, baseline=(2001, 2025), session=None) -> dict:
    """Rain in one season of ``year`` against the baseline mean for that season.

    Both sides come from the same reanalysis (``NORMAL_MODEL``), so the
    comparison is like for like. ``season`` is ``{"label", "start": "MM-DD",
    "end": "MM-DD"}`` within one calendar year.
    """
    def window(y):
        return date.fromisoformat(f"{y}-{season['start']}"), date.fromisoformat(f"{y}-{season['end']}")

    first, last = baseline
    history = fetch_rain(
        lat, lon, date(first, 1, 1), date(last, 12, 31), model=NORMAL_MODEL, session=session,
    )
    totals = [total(history, *window(y)) for y in range(first, last + 1)]
    start, end = window(year)
    current = fetch_rain(lat, lon, start, end, model=NORMAL_MODEL, session=session)
    observed = total(current, start, end)
    if observed is None or None in totals:
        raise SourceError(
            f"{NORMAL_SOURCE} has gaps in the {season['label']} season; it runs about "
            "five days behind, so try again later"
        )
    normal = sum(totals) / len(totals)
    return {
        "label": season["label"],
        "start": start.isoformat(),
        "end": end.isoformat(),
        "source": NORMAL_SOURCE,
        "latitude": current["latitude"],
        "longitude": current["longitude"],
        "total": round(observed, 1),
        "normal": round(normal, 1),
        "pct_of_normal": round(100 * observed / normal) if normal > 0 else None,
        "baseline": f"{first}–{last}",
        # 1 = the driest of the baseline years and this one.
        "rank": 1 + sum(t < observed for t in totals),
        "years": len(totals) + 1,
    }


# ─── Working with daily series ───────────────────────────────────────

def points(series: dict) -> list[dict]:
    """``[{"date", "value"}]`` for every day that has a value."""
    start = date.fromisoformat(series["start"])
    return [
        {"date": (start + timedelta(days=i)).isoformat(), "value": v}
        for i, v in enumerate(series["values"])
        if v is not None
    ]


def _window(series, start: date, end: date) -> Optional[list[float]]:
    """Values from ``start`` to ``end`` inclusive; ``None`` unless all are present."""
    first = date.fromisoformat(series["start"])
    lo, hi = (start - first).days, (end - first).days
    if lo < 0 or hi >= len(series["values"]):
        return None
    values = series["values"][lo:hi + 1]
    return None if any(v is None for v in values) else values


def total(series, start: date, end: date) -> Optional[float]:
    values = _window(series, start, end)
    return None if values is None else float(sum(values))


def before_pass(series, day: date, aggregate: str, window_days: int = WINDOW_DAYS) -> Optional[float]:
    """Sum or mean over the ``window_days`` up to and including ``day``.

    ``None`` unless the series covers the whole window.
    """
    values = _window(series, day - timedelta(days=window_days - 1), day)
    if values is None:
        return None
    result = sum(values) if aggregate == "sum" else sum(values) / len(values)
    return round(float(result), 2)


# ─── Sources ─────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def snapshot() -> dict:
    """Committed driver series for the curated sites: ``{slug: {driver_id: series}}``."""
    if not SNAPSHOT_PATH.exists():
        return {}
    return json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8")).get("sites", {})


def area_rain(bbox, start: date, end: date, *, session=None) -> dict:
    """Live daily rain at the centre of a drawn area, cached briefly."""
    end = min(end, date.today())
    if start > end:
        raise ValueError("The selected dates are in the future.")
    if (end - start).days > MAX_LIVE_DAYS:
        raise ValueError(f"Choose a range of at most {MAX_LIVE_DAYS} days.")
    lat = round((bbox[1] + bbox[3]) / 2, 2)
    lon = round((bbox[0] + bbox[2]) / 2, 2)
    key = (lat, lon, start, end)
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
    series = fetch_rain(lat, lon, start, end, session=session)
    with _cache_lock:
        if len(_cache) >= _CACHE_MAX_ENTRIES:
            _cache.clear()
        _cache[key] = (time.monotonic() + _CACHE_TTL_SECONDS, series)
    return series


def clear_cache():
    with _cache_lock:
        _cache.clear()
