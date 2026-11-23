"""Where NISAR is: its ground track computed from public orbital elements.

NISAR's two-line elements (TLE, NORAD 65053) come from CelesTrak, which
republishes the US Space Force's public catalog. They are fetched at most
every few hours (cached in memory and under ``<DATA_DIR>/orbit/``, shared by
the workers) and propagated with SGP4, the model TLEs are made for
(``sgp4`` package, the reference implementation by Vallado et al.).

SGP4 positions are good to about a kilometer at the elements' epoch and
drift by a few kilometers per day away from it; an orbit-raising or
station-keeping maneuver between the epoch and the time asked for is not
in the elements at all. So tracks are only computed within
``MAX_EPOCH_OFFSET_DAYS`` of the epoch, and the response says how far the
asked-for window is from it. This is a computed path, not NISAR's
reconstructed orbit, and says nothing about when the radar was on.
"""
from __future__ import annotations

import logging
import math
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import requests
from sgp4.api import SGP4_ERRORS, Satrec, jday
from sgp4.propagation import gstime

logger = logging.getLogger(__name__)

NORAD_ID = 65053
CELESTRAK_URL = "https://celestrak.org/NORAD/elements/gp.php"
TLE_TTL_SECONDS = 6 * 3600
FETCH_TIMEOUT_SECONDS = 10
MAX_SPAN = timedelta(days=7)
MIN_STEP_S, MAX_STEP_S = 10, 600
MAX_POINTS = 20000
MAX_EPOCH_OFFSET_DAYS = 14

# WGS84
_A_KM = 6378.137
_E2 = 6.69437999014e-3

_lock = threading.Lock()
_memo: dict = {}


class OrbitError(Exception):
    """The orbital elements couldn't be fetched or propagated."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def _cache_path() -> Path:
    return Path(os.getcwd()) / os.getenv("DATA_DIR", "app-data") / "orbit" / f"{NORAD_ID}.tle"


def parse_tle(text: str) -> tuple[str, str]:
    """The two element lines of a CelesTrak TLE response (with or without a name line)."""
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    line1 = next((ln for ln in lines if ln.startswith("1 ")), None)
    line2 = next((ln for ln in lines if ln.startswith("2 ")), None)
    if not line1 or not line2 or len(line1) < 69 or len(line2) < 69:
        raise ValueError("not a two-line element set")
    if line1[2:7].strip() != str(NORAD_ID) or line2[2:7].strip() != str(NORAD_ID):
        raise ValueError(f"elements are not for NORAD {NORAD_ID}")
    Satrec.twoline2rv(line1, line2)  # raises on malformed lines
    return line1, line2


def _read_disk():
    path = _cache_path()
    try:
        text = path.read_text(encoding="utf-8")
        return parse_tle(text), path.stat().st_mtime
    except (OSError, ValueError):
        return None, None


def _write_disk(line1: str, line2: str):
    path = _cache_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(f"{line1}\n{line2}\n", encoding="utf-8")
        tmp.replace(path)
    except OSError:
        logger.info("Couldn't cache the TLE on disk", exc_info=True)


def _download() -> tuple[str, str]:
    resp = requests.get(
        CELESTRAK_URL,
        params={"CATNR": NORAD_ID, "FORMAT": "TLE"},
        headers={"User-Agent": "nisar-surface-change"},
        timeout=FETCH_TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    return parse_tle(resp.text)


def current_elements() -> dict:
    """NISAR's latest TLE: ``{line1, line2, fetched_at, stale}``.

    Uses the copy in memory or on disk while it is younger than
    ``TLE_TTL_SECONDS``; otherwise downloads a new one. If the download
    fails, an older copy is used and marked ``stale``.
    """
    with _lock:
        now = time.time()
        if _memo.get("lines") and now - _memo["fetched"] < TLE_TTL_SECONDS:
            return _elements_payload(_memo["lines"], _memo["fetched"], stale=False)
        lines, mtime = _read_disk()
        if lines and now - mtime < TLE_TTL_SECONDS:
            _memo.update(lines=lines, fetched=mtime)
            return _elements_payload(lines, mtime, stale=False)
        try:
            lines = _download()
        except (requests.RequestException, ValueError) as exc:
            logger.warning("CelesTrak TLE fetch failed: %s", exc)
            old = _memo.get("lines") and (_memo["lines"], _memo["fetched"])
            if not old and lines:
                old = (lines, mtime)
            if not old:
                raise OrbitError("NISAR's orbital elements are unavailable; try again shortly") from exc
            return _elements_payload(old[0], old[1], stale=True)
        _memo.update(lines=lines, fetched=now)
        _write_disk(*lines)
        return _elements_payload(lines, now, stale=False)


def _elements_payload(lines, fetched, stale):
    sat = Satrec.twoline2rv(*lines)
    return {
        "line1": lines[0],
        "line2": lines[1],
        "epoch": _iso(_epoch_of(sat)),
        "fetched_at": _iso(datetime.fromtimestamp(fetched, timezone.utc)),
        "stale": stale,
        "source": "CelesTrak (US Space Force public catalog)",
    }


def _epoch_of(sat: Satrec) -> datetime:
    return datetime(2000 + sat.epochyr if sat.epochyr < 57 else 1900 + sat.epochyr, 1, 1,
                    tzinfo=timezone.utc) + timedelta(days=sat.epochdays - 1)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def teme_to_geodetic(r_km: np.ndarray, jd: np.ndarray, fr: np.ndarray) -> np.ndarray:
    """``[n, 3]`` TEME positions → ``[n, 3]`` (lon°, lat°, height km) on WGS84.

    TEME is rotated to Earth-fixed by Greenwich mean sidereal time; polar
    motion (meters) is ignored.
    """
    theta = np.array([gstime(j + f) for j, f in zip(jd, fr)])
    cos_t, sin_t = np.cos(theta), np.sin(theta)
    x = cos_t * r_km[:, 0] + sin_t * r_km[:, 1]
    y = -sin_t * r_km[:, 0] + cos_t * r_km[:, 1]
    z = r_km[:, 2]
    lon = np.arctan2(y, x)
    p = np.hypot(x, y)
    lat = np.arctan2(z, p * (1 - _E2))
    for _ in range(5):
        n = _A_KM / np.sqrt(1 - _E2 * np.sin(lat) ** 2)
        h = p / np.cos(lat) - n
        lat = np.arctan2(z, p * (1 - _E2 * n / (n + h)))
    n = _A_KM / np.sqrt(1 - _E2 * np.sin(lat) ** 2)
    h = p / np.cos(lat) - n
    return np.column_stack([np.degrees(lon), np.degrees(lat), h])


def ground_track(start: datetime, end: datetime, step_s: int = 60, elements: dict | None = None) -> dict:
    """NISAR's sub-satellite point every ``step_s`` seconds from ``start`` to ``end`` (UTC).

    ``points`` are ``[seconds after start, lon°, lat°, altitude km]``.
    Raises ``ValueError`` for a window that is too long, too fine, or too
    far from the elements' epoch to mean anything.
    """
    if start.tzinfo is None or end.tzinfo is None:
        raise ValueError("start and end need a time zone (use Z for UTC)")
    if end <= start:
        raise ValueError("end must be after start")
    if end - start > MAX_SPAN:
        raise ValueError(f"the window can be at most {MAX_SPAN.days} days")
    if not MIN_STEP_S <= step_s <= MAX_STEP_S:
        raise ValueError(f"step must be {MIN_STEP_S}-{MAX_STEP_S} seconds")
    count = int((end - start).total_seconds() // step_s) + 1
    if count > MAX_POINTS:
        raise ValueError(f"at most {MAX_POINTS} points; use a larger step")

    elements = elements or current_elements()
    sat = Satrec.twoline2rv(elements["line1"], elements["line2"])
    epoch = _epoch_of(sat)
    far = max(abs((start - epoch).total_seconds()), abs((end - epoch).total_seconds())) / 86400
    if far > MAX_EPOCH_OFFSET_DAYS:
        raise ValueError(
            f"the orbital elements are from {_iso(epoch)}; times more than "
            f"{MAX_EPOCH_OFFSET_DAYS} days from that can't be computed reliably"
        )

    offsets = np.arange(count) * step_s
    jd0, fr0 = jday(start.year, start.month, start.day, start.hour, start.minute,
                    start.second + start.microsecond / 1e6)
    jd = np.full(count, jd0)
    fr = fr0 + offsets / 86400.0
    err, r, _v = sat.sgp4_array(jd, fr)
    if np.any(err):
        code = int(err[np.nonzero(err)[0][0]])
        raise OrbitError(f"orbit propagation failed: {SGP4_ERRORS.get(code, code)}", status=500)
    geo = teme_to_geodetic(np.asarray(r), jd, fr)
    points = [
        [int(t), round(float(lon), 4), round(float(lat), 4), round(float(h), 1)]
        for t, (lon, lat, h) in zip(offsets, geo)
    ]
    mean_motion = sat.no_kozai * 1440 / (2 * math.pi)  # revolutions per day
    return {
        "satellite": "NISAR",
        "norad_id": NORAD_ID,
        "start": _iso(start),
        "end": _iso(start + timedelta(seconds=int(offsets[-1]))),
        "step_s": step_s,
        "period_min": round(1440 / mean_motion, 2),
        "inclination_deg": round(math.degrees(sat.inclo), 3),
        "epoch_offset_days": round(far, 2),
        "elements": elements,
        "points": points,
    }


def clear_cache():
    with _lock:
        _memo.clear()
