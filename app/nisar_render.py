"""Read NISAR HDF5 pixels over a bbox and render them as map images.

Shared by the offline pipeline (``scripts/extract_nisar.py``) and the
live SME2 display (``app/sme2.py``), so both draw radar backscatter with
exactly the same colours and stretches.

Reading needs a free NASA Earthdata Login: either a user token
(``EARTHDATA_TOKEN``) or ``machine urs.earthdata.nasa.gov`` in ``~/.netrc``.
"""
from __future__ import annotations

import io
import math
import os

import numpy as np
import pyproj
import requests
from PIL import Image

from app.nisar import CMR_CLIENT_ID

# Output grid: ~80 m pixels, at most this many on the longer side.
CHIP_MAX_PX = 400
CHIP_PIXEL_M = 80.0

# Calm open water reflects L-band away from the radar: HH below this is
# counted as open water. Rough (windy) water or flooded vegetation is missed.
WATER_HH_DB = -18.0
# Fixed display stretches so the same colour means the same dB everywhere.
STRETCH_DB = {"hh": (-20.0, 0.0), "hv": (-26.0, -8.0), "ratio": (2.0, 12.0)}


def earthdata_token() -> str | None:
    return os.getenv("EARTHDATA_TOKEN", "").strip() or None


class RangeFile(io.RawIOBase):
    """Seekable read-only file over HTTP range requests, cached in 1 MiB blocks."""

    BLOCK = 1 << 20

    def __init__(self, url: str, session: requests.Session, timeout: float = 60):
        self.session = session
        self.timeout = timeout
        # Follows the Earthdata Login redirects to a pre-signed URL that then
        # serves byte ranges directly. requests drops the Authorization
        # header on the cross-host redirect, which the pre-signed URL needs.
        resp = session.get(url, headers={"Range": "bytes=0-0"}, timeout=timeout)
        if resp.status_code != 206:
            raise OSError(
                f"HTTP {resp.status_code} reading {url} "
                "(check your Earthdata Login: EARTHDATA_TOKEN or ~/.netrc)"
            )
        self.url = resp.url
        self.size = int(resp.headers["Content-Range"].split("/")[1])
        self.pos = 0
        self.blocks: dict[int, bytes] = {}
        self.bytes_read = 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=io.SEEK_SET):
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self.pos, io.SEEK_END: self.size}[whence]
        self.pos = base + offset
        return self.pos

    def _block(self, index: int) -> bytes:
        block = self.blocks.get(index)
        if block is None:
            lo = index * self.BLOCK
            hi = min(lo + self.BLOCK, self.size) - 1
            resp = self.session.get(
                self.url, headers={"Range": f"bytes={lo}-{hi}"}, timeout=self.timeout * 2,
            )
            resp.raise_for_status()
            block = resp.content
            self.bytes_read += len(block)
            if len(self.blocks) > 256:
                self.blocks.clear()
            self.blocks[index] = block
        return block

    def readinto(self, buf):
        n = min(len(buf), self.size - self.pos)
        if n <= 0:
            return 0
        out = bytearray()
        pos, end = self.pos, self.pos + n
        while pos < end:
            index = pos // self.BLOCK
            block = self._block(index)
            offset = pos - index * self.BLOCK
            take = min(len(block) - offset, end - pos)
            out += block[offset:offset + take]
            pos += take
        buf[:n] = out
        self.pos = end
        return n


def open_remote(url: str, token: str | None = None, timeout: float = 60):
    """``(h5py.File, RangeFile)`` for a NISAR HDF5 URL.

    Uses ``token`` (or ``EARTHDATA_TOKEN``) as a bearer token when set;
    otherwise requests falls back to credentials in ``~/.netrc``.
    """
    import h5py  # heavy import, only needed when actually reading

    session = requests.Session()
    session.headers["Client-Id"] = CMR_CLIENT_ID
    token = token or earthdata_token()
    if token:
        session.headers["Authorization"] = f"Bearer {token}"
    fobj = RangeFile(url, session, timeout=timeout)
    return h5py.File(fobj, "r"), fobj


# ─── Resampling onto a lat/lon grid over the bbox ───────────────────

def target_grid(bbox, max_px: int = CHIP_MAX_PX):
    """Pixel-centre lon/lat arrays of a north-up grid over ``bbox``.

    ~80 m pixels, coarsened so the longer side has at most ``max_px``.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    mid_lat = math.radians((min_lat + max_lat) / 2)
    width_m = (max_lon - min_lon) * 111_320 * math.cos(mid_lat)
    height_m = (max_lat - min_lat) * 110_574
    scale = min(1.0, max_px / max(width_m, height_m) * CHIP_PIXEL_M)
    nx = max(2, round(width_m / CHIP_PIXEL_M * scale))
    ny = max(2, round(height_m / CHIP_PIXEL_M * scale))
    lons = min_lon + (np.arange(nx) + 0.5) * (max_lon - min_lon) / nx
    lats = max_lat - (np.arange(ny) + 0.5) * (max_lat - min_lat) / ny
    return np.meshgrid(lons, lats)


def resample(group, bbox, layers: dict[str, object], max_px: int = CHIP_MAX_PX) -> dict | None:
    """Nearest-neighbour sample ``layers`` ({path: fill}) of a projected grid onto the bbox grid.

    ``group`` must hold ``projection`` (EPSG code), ``xCoordinates`` and
    ``yCoordinates``: UTM/polar for L2 products, EASE-Grid 2.0 for SME2.
    """
    epsg = int(group["projection"][()])
    x = group["xCoordinates"][()]
    y = group["yCoordinates"][()]
    lon, lat = target_grid(bbox, max_px)
    gx, gy = pyproj.Transformer.from_crs(4326, epsg, always_xy=True).transform(lon, lat)
    cols = np.floor((gx - x[0]) / (x[1] - x[0]) + 0.5).astype(int)
    rows = np.floor((gy - y[0]) / (y[1] - y[0]) + 0.5).astype(int)
    inside = (cols >= 0) & (cols < x.size) & (rows >= 0) & (rows < y.size)
    if not inside.any():
        return None
    r0, r1 = rows[inside].min(), rows[inside].max() + 1
    c0, c1 = cols[inside].min(), cols[inside].max() + 1
    out = {}
    for path, fill in layers.items():
        window = group[path][r0:r1, c0:c1]
        arr = np.full(lon.shape, fill, dtype=window.dtype)
        arr[inside] = window[rows[inside] - r0, cols[inside] - c0]
        out[path.split("/")[-1]] = arr
    return out


def erode(mask: np.ndarray, pixels: int) -> np.ndarray:
    """Shrink a boolean mask by ``pixels`` (drops artefacts at swath edges)."""
    out = mask.copy()
    for _ in range(pixels):
        shrunk = out.copy()
        shrunk[1:, :] &= out[:-1, :]
        shrunk[:-1, :] &= out[1:, :]
        shrunk[:, 1:] &= out[:, :-1]
        shrunk[:, :-1] &= out[:, 1:]
        out = shrunk
    return out


# ─── Colours and encoding ────────────────────────────────────────────

def to_db(v):
    return 10.0 * np.log10(v)


def gcov_rgb(hh, hv):
    """R = HH, G = HV, B = HH/HV with fixed stretches (linear power in, 0-255 out)."""
    def stretch(db, key):
        lo, hi = STRETCH_DB[key]
        return np.clip((db - lo) / (hi - lo), 0, 1)

    with np.errstate(divide="ignore", invalid="ignore"):
        hh_db, hv_db = to_db(hh), to_db(hv)
        rgb = np.stack([
            stretch(hh_db, "hh"), stretch(hv_db, "hv"), stretch(hh_db - hv_db, "ratio"),
        ], axis=-1)
    return np.nan_to_num(rgb) ** 0.8 * 255  # mild gamma lifts the dark end


def ramp_rgb(values, lo, hi, stops):
    """Map ``values`` linearly from ``lo``..``hi`` onto evenly spaced RGB ``stops``."""
    t = np.clip((np.nan_to_num(values, nan=lo) - lo) / (hi - lo), 0, 1)
    colours = np.asarray(stops, dtype=float)
    pos = t * (len(colours) - 1)
    i = np.minimum(np.floor(pos).astype(int), len(colours) - 2)
    frac = (pos - i)[..., None]
    return colours[i] + (colours[i + 1] - colours[i]) * frac


def encode_webp(rgb: np.ndarray, valid: np.ndarray) -> bytes:
    """RGBA WebP: invalid pixels are fully transparent."""
    rgba = np.dstack([rgb.astype(np.uint8), (valid * 255).astype(np.uint8)])
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, "WEBP", quality=72, method=6)
    return buf.getvalue()
