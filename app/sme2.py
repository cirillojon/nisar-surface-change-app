"""NISAR SME2 (Level-3 soil moisture) images and values for any area.

SME2 granules have no public browse images, so the backend renders each
granule once, over its whole frame (~240 km), from the HDF5 file (HTTP
range requests, needs an Earthdata Login):

* ``backscatter.webp``: SME2's own HH/HV sigma-0 layers drawn exactly like
  the GCOV study sites (R = HH, G = HV, B = HH/HV, same fixed dB
  stretches), so an SME2 pass looks like the Mekong Delta time-lapse.
* ``soil_moisture.webp``: volumetric soil moisture on a fixed dry-to-wet ramp.
* ``stats.npz``: HH, HV (dB) and soil moisture on a half-resolution grid,
  quantized to one byte each, so values for any area (median HH / HV dB,
  open-water share, median soil moisture) are computed instantly.

Frames are cached under ``<DATA_DIR>/sme2/<key>/`` (~0.8 MB each). The map
clips frame images to the area, so any area, zoom or mosaic that touches a
cached frame is instant. Prewarm regions with ``flask nisar sme2-prewarm``.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from pathlib import Path

import numpy as np
import requests

from app import nisar
from app.nisar_render import (
    WATER_HH_DB,
    earthdata_token,
    encode_webp,
    erode,
    gcov_rgb,
    open_hdf5,
    ramp_rgb,
    resample,
    target_grid,
    to_db,
)

logger = logging.getLogger(__name__)

PRODUCT = "SME2"
LAYERS = ("backscatter", "soil_moisture")
# Bump when rendering changes; older cache entries are then ignored.
CACHE_VERSION = "v3"
# Longest image side for a whole frame (~240 km): ~185 m pixels, about
# SME2's own 200 m grid.
MAX_PX = 1400
# Values grid keeps every STATS_STEP-th pixel (~370 m): plenty for medians.
STATS_STEP = 2
# Areas larger than this are refused (values come from frames; this only
# guards against nonsense requests).
MAX_AREA_DEG = 30.0
GRIDS = "science/LSAR/SME2/grids"
# SME2 posts on a 200 m grid; trim one cell along swath edges.
EDGE_ERODE_PX = 2
# Fixed so the same color means the same wetness on every pass and area.
SOIL_MOISTURE_RANGE = (0.0, 0.5)  # m3/m3
# Dry (brown) to wet (teal), ColorBrewer BrBG.
SOIL_MOISTURE_STOPS = [
    (140, 81, 10), (191, 129, 45), (223, 194, 125),
    (128, 205, 193), (53, 151, 143), (1, 102, 94),
]
# One-byte quantization of the values grid; 255 = no data.
DB_MIN, DB_STEP = -40.0, 0.25          # -40 .. +23.5 dB
SM_STEP = 0.0025                        # 0 .. 0.635 m3/m3
NODATA = 255

_TITLE_RE = re.compile(r"^NISAR_L3_PR_SME2_[A-Za-z0-9_]{10,200}$")
_KEY_RE = re.compile(r"^[0-9a-f]{24}$")
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


class Sme2Error(Exception):
    """Base class; ``status`` is the HTTP status the API should answer with."""

    status = 502


class Sme2Unavailable(Sme2Error):
    status = 503


class Sme2NotFound(Sme2Error):
    status = 404


class Sme2NoData(Sme2Error):
    status = 422


def cache_dir() -> Path:
    return Path(os.getcwd()) / os.getenv("DATA_DIR", "app-data") / "sme2"


def has_credentials() -> bool:
    if earthdata_token():
        return True
    return bool(requests.utils.get_netrc_auth("https://urs.earthdata.nasa.gov"))


def validate_title(title: str) -> str:
    if not isinstance(title, str) or not _TITLE_RE.match(title):
        raise ValueError("granule must be an SME2 granule name (NISAR_L3_PR_SME2_...)")
    return title


def validate_area(bbox: list[float]) -> list[float]:
    if bbox[2] - bbox[0] > MAX_AREA_DEG or bbox[3] - bbox[1] > MAX_AREA_DEG:
        raise ValueError(f"bbox must be at most {MAX_AREA_DEG:g} degrees per side")
    return bbox


def frame_key(title: str) -> str:
    return hashlib.sha1(f"{CACHE_VERSION}|{title}".encode()).hexdigest()[:24]


def image_path(key: str, layer: str) -> Path | None:
    """Cached image file for ``key``/``layer``, or ``None`` if invalid or missing."""
    if not _KEY_RE.match(key or "") or layer not in LAYERS:
        return None
    path = cache_dir() / key / f"{layer}.webp"
    return path if path.is_file() else None


def is_cached(title: str) -> bool:
    return (cache_dir() / frame_key(title) / "meta.json").is_file()


def _lock_for(key: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


# ─── Public API ──────────────────────────────────────────────────────

def get_scene(title: str, bbox: list[float]) -> dict:
    """One SME2 granule for an area: frame images (rendered once) + area values."""
    meta = ensure_frame(title)
    return {
        "granule_id": meta["granule_id"],
        "date": meta["date"],
        "quality": meta["quality"],
        "source": meta.get("source", "NASA CMR"),
        "collection": meta.get("collection"),
        "processing_variant": meta.get(
            "processing_variant",
            nisar.granule_name_metadata(meta["granule_id"])["processing_variant"],
        ),
        "quality_flags_applied": meta.get("quality_flags_applied", False),
        "quality_flags_note": meta.get(
            "quality_flags_note",
            "SME2 retrieval-quality flags are not applied. The renderer masks fill/non-finite values and swath edges only.",
        ),
        "frequency": meta["frequency"],
        # The images cover the whole frame; the map clips them to the area.
        "image_bbox": meta["bbox"],
        "images": meta["images"],
        **area_values(meta, bbox),
    }


def ensure_frame(title: str, granule: dict | None = None) -> dict:
    """Frame metadata, rendering the granule first if it isn't cached.

    Pass ``granule`` (a parsed CMR entry) to skip the CMR lookup.
    """
    key = frame_key(title)
    meta_path = cache_dir() / key / "meta.json"
    # One render per granule at a time; later callers get the cache.
    with _lock_for(key):
        if meta_path.is_file():
            return json.loads(meta_path.read_text(encoding="utf-8"))
        if not has_credentials():
            raise Sme2Unavailable(
                "Showing SME2 needs a NASA Earthdata Login: set EARTHDATA_TOKEN in "
                "the backend's .env and restart it"
            )
        if granule is None:
            granule = nisar.granule_by_title(title, PRODUCT)
        if not granule or not granule.get("data_url") or not granule.get("bbox"):
            raise Sme2NotFound("SME2 granule not found in NASA CMR")
        meta = _render(key, granule)
        meta_path.write_text(json.dumps(meta), encoding="utf-8")
        return meta


def import_local_file(path: str | Path, bbox: list[float]) -> dict:
    """Render a local SME2 HDF5 into the normal cache for offline use."""
    source = Path(path).expanduser().resolve(strict=True)
    title = validate_title(source.stem)
    bbox = validate_area(bbox)
    match = re.search(r"_(\d{8})T\d{6}_", title)
    if not match:
        raise ValueError("local SME2 filename must include its NISAR acquisition timestamp")
    day = f"{match.group(1)[:4]}-{match.group(1)[4:6]}-{match.group(1)[6:8]}"
    granule = {
        "title": title,
        "start": f"{day}T00:00:00Z",
        "quality": "unknown",
        "bbox": bbox,
        "data_url": str(source),
        "source": "local HDF5",
        "collection": None,
    }
    key = frame_key(title)
    meta_path = cache_dir() / key / "meta.json"
    with _lock_for(key):
        meta = _render(key, granule)
        meta_path.write_text(json.dumps(meta), encoding="utf-8")
    return meta


def prewarm_one(granule: dict) -> dict:
    """Render one granule if needed (for process pools). Never raises."""
    title = granule["title"]
    if is_cached(title):
        return {"title": title, "status": "cached"}
    started = time.monotonic()
    try:
        meta = ensure_frame(title, granule)
    except Exception as exc:  # noqa: BLE001 — report and keep going
        return {"title": title, "status": "failed", "error": str(exc)}
    return {
        "title": title,
        "status": "rendered",
        "seconds": round(time.monotonic() - started, 1),
        "mb_read": meta.get("mb_read"),
    }


# ─── Rendering ───────────────────────────────────────────────────────

def _attr(dataset, name) -> str:
    value = dataset.attrs.get(name, b"")
    return value.decode() if isinstance(value, bytes) else str(value)


def _read(granule: dict, bbox: list[float]) -> dict:
    try:
        h5, fobj = open_hdf5(granule["data_url"], timeout=30)
    except OSError as exc:
        logger.warning("SME2 open failed for %s: %s", granule["title"], exc)
        status = str(exc)
        if "HTTP 401" in status or "HTTP 403" in status:
            raise Sme2Unavailable(
                "NASA Earthdata rejected the login; check EARTHDATA_TOKEN"
            ) from exc
        raise Sme2Error("Could not read the SME2 file from NASA; try again shortly") from exc

    with h5:
        if GRIDS not in h5:
            raise Sme2NoData("This file has no SME2 grids")
        grids = h5[GRIDS]
        out = {"frequency": None, "bs": None, "sm": None}
        radar = grids.get("radarData")
        # Prefer B when it contains both requested polarizations; otherwise
        # use A. The available frequency and polarization depend on the mode.
        for freq in ("frequencyB", "frequencyA"):
            group = radar.get(freq) if radar is not None else None
            if group is not None and "sigma0HH" in group and "sigma0HV" in group:
                px = resample(group, bbox, {"sigma0HH": np.nan, "sigma0HV": np.nan}, MAX_PX)
                if px is not None:
                    hh, hv = px["sigma0HH"].astype(float), px["sigma0HV"].astype(float)
                    # The spec says linear ("unitless"); convert if a file says dB.
                    if _attr(group["sigma0HH"], "units").lower() in ("db", "decibel", "decibels"):
                        hh, hv = 10 ** (hh / 10), 10 ** (hv / 10)
                    out["frequency"], out["bs"] = freq, (hh, hv)
                break
        if "soilMoisture" in grids:
            px = resample(grids, bbox, {"soilMoisture": np.nan}, MAX_PX)
            if px is not None:
                out["sm"] = px["soilMoisture"].astype(float)
        out["mb_read"] = round(fobj.bytes_read / 1e6, 1) if fobj.bytes_read is not None else None
        return out


def _quantize(values, valid, lo, step):
    q = np.full(values.shape, NODATA, dtype=np.uint8)
    q[valid] = np.clip(np.round((values[valid] - lo) / step), 0, NODATA - 1)
    return q


def _render(key: str, granule: dict) -> dict:
    bbox = [float(v) for v in granule["bbox"]]
    try:
        px = _read(granule, bbox)
    except (requests.RequestException, KeyError) as exc:
        logger.warning("SME2 read failed for %s: %s", granule["title"], exc)
        raise Sme2Error("Could not read the SME2 file from NASA; try again shortly") from exc

    folder = cache_dir() / key
    folder.mkdir(parents=True, exist_ok=True)
    images = {}
    shape = target_grid(bbox, MAX_PX)[0].shape
    stats = {
        name: np.full(shape, NODATA, dtype=np.uint8)
        for name in ("hh_q", "hv_q", "sm_q")
    }

    if px["bs"] is not None:
        hh, hv = px["bs"]
        with np.errstate(invalid="ignore"):
            valid = np.isfinite(hh) & np.isfinite(hv) & (hh > 0) & (hv > 0)
        valid = erode(valid, EDGE_ERODE_PX)
        if valid.any():
            (folder / "backscatter.webp").write_bytes(encode_webp(gcov_rgb(hh, hv), valid))
            images["backscatter"] = f"/api/nisar/sme2/images/{key}/backscatter.webp"
            with np.errstate(divide="ignore", invalid="ignore"):
                stats["hh_q"] = _quantize(to_db(hh), valid, DB_MIN, DB_STEP)
                stats["hv_q"] = _quantize(to_db(hv), valid, DB_MIN, DB_STEP)

    if px["sm"] is not None:
        sm = px["sm"]
        with np.errstate(invalid="ignore"):
            valid = np.isfinite(sm) & (sm >= 0) & (sm <= 1)  # fill is -9999
        if valid.any():
            rgb = ramp_rgb(sm, *SOIL_MOISTURE_RANGE, SOIL_MOISTURE_STOPS)
            (folder / "soil_moisture.webp").write_bytes(encode_webp(rgb, valid))
            images["soil_moisture"] = f"/api/nisar/sme2/images/{key}/soil_moisture.webp"
            stats["sm_q"] = _quantize(sm, valid, 0.0, SM_STEP)

    if not images:
        raise Sme2NoData("This SME2 pass has no valid data")

    np.savez_compressed(
        folder / "stats.npz",
        **{k: v[::STATS_STEP, ::STATS_STEP] for k, v in stats.items()},
    )
    logger.info("SME2 %s rendered (%s MB read)", granule["title"], px["mb_read"])
    return {
        "granule_id": granule["title"],
        "date": (granule.get("start") or "")[:10],
        "quality": granule.get("quality"),
        "source": granule.get("source", "NASA CMR"),
        "collection": granule.get("collection"),
        "processing_variant": nisar.granule_name_metadata(granule["title"])["processing_variant"],
        "quality_flags_applied": False,
        "quality_flags_note": (
            "SME2 retrieval-quality flags are not applied. The renderer masks fill/non-finite "
            "values and swath edges only."
        ),
        "bbox": bbox,
        "grid_shape": list(shape),
        "frequency": px["frequency"],
        "images": images,
        "mb_read": px["mb_read"],
    }


# ─── Values over an area ─────────────────────────────────────────────

def _stats_window(meta: dict, bbox: list[float]):
    """Row/column slices of the values grid inside ``bbox``, or ``None``."""
    min_lon, min_lat, max_lon, max_lat = meta["bbox"]
    ny, nx = meta["grid_shape"]
    lons = min_lon + (np.arange(nx)[::STATS_STEP] + 0.5) * (max_lon - min_lon) / nx
    lats = max_lat - (np.arange(ny)[::STATS_STEP] + 0.5) * (max_lat - min_lat) / ny
    cols = np.nonzero((lons >= bbox[0]) & (lons <= bbox[2]))[0]
    rows = np.nonzero((lats >= bbox[1]) & (lats <= bbox[3]))[0]
    if not cols.size or not rows.size:
        return None
    return slice(rows[0], rows[-1] + 1), slice(cols[0], cols[-1] + 1)


def area_values(meta: dict, bbox: list[float]) -> dict:
    """``{"values": {...}, "valid_pct": {...}}`` over the part of ``bbox`` in this frame.

    Medians, as for the study sites: bright outliers would skew a mean.
    ``valid_pct`` is the share of the area's pixels (within the frame's
    image) that have data.
    """
    window = _stats_window(meta, bbox)
    values, valid_pct = {}, {}
    if window is None:
        return {"values": values, "valid_pct": valid_pct}
    path = cache_dir() / frame_key(meta["granule_id"]) / "stats.npz"
    with np.load(path) as data:
        hh_q, hv_q, sm_q = (data[k][window] for k in ("hh_q", "hv_q", "sm_q"))

    bs_valid = (hh_q != NODATA) & (hv_q != NODATA)
    if bs_valid.any():
        hh_db = DB_MIN + hh_q[bs_valid] * DB_STEP
        hv_db = DB_MIN + hv_q[bs_valid] * DB_STEP
        values["hh_db"] = round(float(np.median(hh_db)), 2)
        values["hv_db"] = round(float(np.median(hv_db)), 2)
        values["water_pct"] = round(float((hh_db < WATER_HH_DB).mean() * 100), 1)
        valid_pct["backscatter"] = round(float(bs_valid.mean()) * 100, 1)
    sm_valid = sm_q != NODATA
    if sm_valid.any():
        values["soil_moisture"] = round(float(np.median(sm_q[sm_valid] * SM_STEP)), 3)
        valid_pct["soil_moisture"] = round(float(sm_valid.mean()) * 100, 1)
    return {"values": values, "valid_pct": valid_pct}
