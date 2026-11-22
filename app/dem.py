"""Terrain heights from the Copernicus GLO-90 DEM (public, no login).

Tiles (1 x 1 degree GeoTIFF, ~5 MB) are downloaded on first use from the
AWS open-data bucket and cached under ``<DATA_DIR>/dem/``. Heights are
meters above the EGM2008 geoid (within ~50 m of the ellipsoid heights
NISAR's correction cubes use, which is negligible for troposphere).

Copernicus DEM (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH
2014-2018, provided under COPERNICUS by the European Union and ESA.
"""
from __future__ import annotations

import math
import os
import threading
from pathlib import Path

import numpy as np
import requests

DEM_URL = "https://copernicus-dem-90m.s3.amazonaws.com/{name}/{name}.tif"
_tiles: dict[str, np.ndarray | None] = {}
_lock = threading.Lock()


def dem_dir() -> Path:
    return Path(os.getcwd()) / os.getenv("DATA_DIR", "app-data") / "dem"


def tile_name(lat: int, lon: int) -> str:
    ns, ew = ("N" if lat >= 0 else "S"), ("E" if lon >= 0 else "W")
    return f"Copernicus_DSM_COG_30_{ns}{abs(lat):02d}_00_{ew}{abs(lon):03d}_00_DEM"


def _tile(lat: int, lon: int, folder: Path | None = None):
    """Height array for [lat, lat+1) x [lon, lon+1), or ``None`` over open ocean."""
    import tifffile

    name = tile_name(lat, lon)
    with _lock:
        if name in _tiles:
            return _tiles[name]
    folder = folder or dem_dir()
    path = folder / f"{name}.tif"
    missing = folder / f"{name}.none"
    if missing.exists():
        tile = None
    else:
        if not path.exists():
            folder.mkdir(parents=True, exist_ok=True)
            resp = requests.get(DEM_URL.format(name=name), timeout=120)
            if resp.status_code in (403, 404):  # no tile: open ocean
                missing.touch()
                tile = None
            else:
                resp.raise_for_status()
                path.write_bytes(resp.content)
        tile = tifffile.imread(path) if path.exists() else None
    with _lock:
        _tiles[name] = tile
    return tile


def heights(lon, lat, folder: Path | None = None) -> np.ndarray:
    """Terrain height (m) at each lon/lat (nearest DEM sample); NaN over ocean."""
    lon = np.asarray(lon, dtype=float)
    lat = np.asarray(lat, dtype=float)
    out = np.full(lon.shape, np.nan)
    for la in range(math.floor(np.nanmin(lat)), math.floor(np.nanmax(lat)) + 1):
        for lo in range(math.floor(np.nanmin(lon)), math.floor(np.nanmax(lon)) + 1):
            sel = (np.floor(lat) == la) & (np.floor(lon) == lo)
            if not sel.any():
                continue
            tile = _tile(la, lo, folder)
            if tile is None:
                continue
            ny, nx = tile.shape
            rows = np.clip(((la + 1 - lat[sel]) * ny).astype(int), 0, ny - 1)
            cols = np.clip(((lon[sel] - lo) * nx).astype(int), 0, nx - 1)
            out[sel] = tile[rows, cols]
    return out
