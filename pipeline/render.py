"""Read a window of a NISAR GCOV granule and render it like the land-change gallery.

Shared by ``scripts/build_landchange.py`` (the curated gallery) and the
automated pipeline (``pipeline.ingest``), so a place found automatically is
drawn exactly like one chosen by hand: false colour (R = HH, G = HV,
B = HH/HV), plus an 8-bit HH dB layer the browser turns into change maps.
"""
from __future__ import annotations

import math
from collections import defaultdict

import numpy as np
from PIL import Image

GRID = "science/LSAR/GCOV/grids/frequencyA"
PIX_M = 20.0          # finest pixel (frequency A posting)
MAX_PX = 450          # longest image side (a site may set "max_px")
DB_LO, DB_HI = -30.0, 5.0
MIN_VALID = 0.5       # skip passes with less of the window imaged
WATER_DB = -18.0      # the app's open-water threshold (HH below this)


def grid(lon, lat, half_km, max_px=MAX_PX):
    """Lon/lat pixel centres of a square window, its bbox and pixel size (m)."""
    px = max(PIX_M, half_km * 2000 / max_px)
    n = int(round(half_km * 2000 / px))
    dlon = half_km / (111.32 * math.cos(math.radians(lat)))
    dlat = half_km / 110.57
    lons = lon - dlon + (np.arange(n) + 0.5) * 2 * dlon / n
    lats = lat + dlat - (np.arange(n) + 0.5) * 2 * dlat / n
    return np.meshgrid(lons, lats), [lon - dlon, lat - dlat, lon + dlon, lat + dlat], px


def render_pass(args):
    """One pass → ``(slug, granule, data, note)``.

    ``data`` is ``(rgb, hh_db, valid, polarizations, hv_db)`` (``hv_db`` is
    ``None`` when HV wasn't collected), or ``None`` with the reason in ``note``.
    """
    import pyproj

    from app.nisar_render import gcov_rgb, open_remote

    slug, granule, lon, lat, half, max_px = args
    try:
        (LON, LAT), _, _ = grid(lon, lat, half, max_px)
        h5, fobj = open_remote(granule["data_url"], timeout=60)
        with h5:
            g = h5[GRID]
            pols = {p.decode() for p in g["listOfPolarizations"][()]}
            co = "HH" if "HH" in pols else "VV"
            cx = {"HH": "HV", "VV": "VH"}[co]
            cx = cx if cx in pols else None
            epsg = int(g["projection"][()])
            x, y = g["xCoordinates"][()], g["yCoordinates"][()]
            gx, gy = pyproj.Transformer.from_crs(4326, epsg, always_xy=True).transform(LON, LAT)
            cols = np.floor((gx - x[0]) / (x[1] - x[0]) + 0.5).astype(int)
            rows = np.floor((gy - y[0]) / (y[1] - y[0]) + 0.5).astype(int)
            ok = (cols >= 0) & (cols < x.size) & (rows >= 0) & (rows < y.size)
            if not ok.any():
                return slug, granule, None, "outside the image"
            r0, r1 = rows[ok].min(), rows[ok].max() + 1
            c0, c1 = cols[ok].min(), cols[ok].max() + 1
            bands = {}
            for p in [co] + ([cx] if cx else []):
                win = g[p * 2][r0:r1, c0:c1]
                arr = np.full(LON.shape, np.nan)
                arr[ok] = win[rows[ok] - r0, cols[ok] - c0]
                bands[p] = arr
        hh = bands[co]
        valid = np.isfinite(hh) & (hh > 0)
        if valid.mean() < MIN_VALID:
            return slug, granule, None, f"only {valid.mean():.0%} of the window imaged"
        with np.errstate(divide="ignore", invalid="ignore"):
            db = 10 * np.log10(hh)
            hv_db = 10 * np.log10(bands[cx]) if cx else None
        if cx:
            rgb = gcov_rgb(hh, bands[cx])
        else:
            v = np.clip((np.nan_to_num(db, nan=-30) + 25) / 25, 0, 1) ** 0.8 * 255
            rgb = np.dstack([v, v, v])
        pol_label = co + ("+" + cx if cx else "")
        return slug, granule, (rgb, db, valid, pol_label, hv_db), f"{fobj.bytes_read / 1e6:.0f} MB"
    except Exception as exc:  # noqa: BLE001 — report and keep going
        return slug, granule, None, str(exc)[:100]


def hh_png(db, valid):
    """Half-resolution 8-bit dB layer (2x2 mean in power)."""
    ny, nx = (db.shape[0] // 2) * 2, (db.shape[1] // 2) * 2
    p = np.where(valid, 10 ** (np.nan_to_num(db) / 10), np.nan)[:ny, :nx]
    p = p.reshape(ny // 2, 2, nx // 2, 2)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.nanmean(p, axis=(1, 3))
        d = 10 * np.log10(mean)
    q = np.clip(np.round((d - DB_LO) / (DB_HI - DB_LO) * 254), 0, 254)
    q = np.where(np.isfinite(d), q, 255).astype(np.uint8)
    return Image.fromarray(q, "L")


def frame_of(title: str) -> str:
    """``<track>_<A|D>_<frame>`` from a NISAR L2 granule title."""
    return "_".join(title.split("_")[5:8])


def mode_of(title: str) -> str | None:
    """Acquisition mode (for example ``4005_DHDH``) from a GCOV title, if present."""
    parts = (title or "").split("_")
    return "_".join(parts[8:10]) if len(parts) > 9 else None


def best_frame(granules, frame: str | None = None):
    """The frame with most pass dates (or ``frame``) and one granule per day on it.

    Where a day has both, the validated granule is kept.
    """
    by = defaultdict(list)
    for g in granules:
        by[frame_of(g["title"])].append(g)
    if not by:
        return None, []
    if frame is None or frame not in by:
        frame = max(by, key=lambda k: len({g["start"][:10] for g in by[k]}))
    per_day = {}
    for g in sorted(by[frame], key=lambda g: (g.get("quality") == "validated", g["title"])):
        per_day[g["start"][:10]] = g
    return frame, [per_day[d] for d in sorted(per_day)]


def box_stats(db, valid, hv_db=None) -> dict:
    """One number per pass over the window: median HH and HV (dB), open-water share (%)."""
    hh = db[valid & np.isfinite(db)]
    out = {"hh_db": round(float(np.median(hh)), 2) if hh.size else None,
           "water_pct": round(float((hh < WATER_DB).mean() * 100), 1) if hh.size else None}
    if hv_db is not None:
        hv = hv_db[valid & np.isfinite(hv_db)]
        out["hv_db"] = round(float(np.median(hv)), 2) if hv.size else None
    return out


def load_hh_layer(path) -> np.ndarray:
    """An ``.hh.png`` layer back to dB (NaN where no data)."""
    a = np.asarray(Image.open(path)).astype(float)
    return np.where(a == 255, np.nan, DB_LO + a / 254 * (DB_HI - DB_LO))
