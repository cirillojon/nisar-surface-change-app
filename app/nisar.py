"""Find NISAR granules through NASA's Common Metadata Repository (CMR).

CMR search is public — no Earthdata Login needed. Downloading the HDF5
files *does* need a free Earthdata Login account
(https://urs.earthdata.nasa.gov); the ``data_url`` values returned here
redirect to that login in the browser.

Browse PNGs are public, which is what the map overlays use.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from datetime import date
from urllib.parse import urlsplit

import requests

logger = logging.getLogger(__name__)

CMR_GRANULES_URL = "https://cmr.earthdata.nasa.gov/search/granules.json"
CMR_CLIENT_ID = "nisar-surface-change"
# CMR usually answers in under a second but some searches take 10-15 s.
# Must stay below the frontend's NISAR timeout and gunicorn's 30 s.
CMR_TIMEOUT_SECONDS = 25
# Per request while resolving browse bounds (up to three in a row).
BOUNDS_TIMEOUT_SECONDS = 8

# Only host we fetch browse KMLs from (the URL comes from the client).
BROWSE_HOST = "nisar.asf.earthdatacloud.nasa.gov"
_KML_COORDS_RE = re.compile(r"<coordinates>([^<]+)</coordinates>")
# Captures "<track>_<A|D>_<frame>" from an L2 granule's browse KML path.
_FRAME_RE = re.compile(r"/NISAR_L2_PR_[A-Z]{4}_\d{3}_(\d{3}_[AD]_\d{3})_[^/]*_LATLON\.kml$")
_VALIDATED_L2 = [
    "NISAR_L2_GCOV_V1", "NISAR_L2_GUNW_V1", "NISAR_L2_GOFF_V1", "NISAR_L2_GSLC_V1",
]

# Validated collections first; provisional ones carry far more granules
# while the validated archive fills in. Short names verified against CMR.
PRODUCTS = {
    "GCOV": {
        "label": "Backscatter (GCOV)",
        "description": "Geocoded polarimetric covariance — calibrated radar brightness. "
                       "Use for floods, wetlands, fire scars, crops and forest loss.",
        "collections": ["NISAR_L2_GCOV_V1", "NISAR_L2_GCOV_PROVISIONAL_V1"],
    },
    "GUNW": {
        "label": "Interferogram (GUNW)",
        "description": "Geocoded unwrapped interferogram — ground displacement between "
                       "two passes. Use for earthquakes, volcanoes and subsidence.",
        "collections": ["NISAR_L2_GUNW_V1", "NISAR_L2_GUNW_PROVISIONAL_V1"],
    },
    "GOFF": {
        "label": "Pixel offsets (GOFF)",
        "description": "Geocoded pixel offsets — large surface motion such as glacier "
                       "flow and landslides.",
        "collections": ["NISAR_L2_GOFF_V1", "NISAR_L2_GOFF_PROVISIONAL_V1"],
    },
    "GSLC": {
        "label": "Single-look complex (GSLC)",
        "description": "Geocoded single-look complex — full-resolution amplitude and "
                       "phase for custom processing.",
        "collections": ["NISAR_L2_GSLC_V1", "NISAR_L2_GSLC_PROVISIONAL_V1"],
    },
    "SME2": {
        "label": "Soil moisture (SME2)",
        "description": "Level-3 soil moisture. Useful context for agriculture and floods.",
        "collections": ["NISAR_L3_SME2_PROVISIONAL_V1"],
    },
}

# Enough for a time slider / mosaic over a large drawn area.
MAX_RESULTS = 200
_CACHE_TTL_SECONDS = 600
_CACHE_MAX_ENTRIES = 256
_cache: dict[tuple, tuple[float, object]] = {}
_cache_lock = threading.Lock()
_MISS = object()


def _cache_get(key):
    with _cache_lock:
        hit = _cache.get(key)
        return hit[1] if hit and hit[0] > time.monotonic() else _MISS


def _cache_put(key, value):
    with _cache_lock:
        if len(_cache) >= _CACHE_MAX_ENTRIES:
            _cache.clear()
        _cache[key] = (time.monotonic() + _CACHE_TTL_SECONDS, value)


class NisarSearchError(Exception):
    """CMR was unreachable or returned an error."""


def product_list():
    return [{"id": key, **meta} for key, meta in PRODUCTS.items()]


def search_granules(
    bbox: list[float],
    start: date,
    end: date,
    product: str = "GCOV",
    limit: int = 20,
) -> dict:
    """Return ``{"product", "hits", "granules": [...]}``, newest first.

    ``bbox`` is ``[min_lon, min_lat, max_lon, max_lat]``. Results are
    cached in-process for 10 minutes to stay friendly to CMR.
    """
    if product not in PRODUCTS:
        raise ValueError(f"unknown product {product!r}")
    limit = max(1, min(int(limit), MAX_RESULTS))
    key = (product, tuple(round(v, 4) for v in bbox), start, end, limit)
    cached = _cache_get(key)
    if cached is not _MISS:
        return cached

    params = {
        "short_name[]": PRODUCTS[product]["collections"],
        "bounding_box": ",".join(str(v) for v in bbox),
        "temporal": f"{start.isoformat()}T00:00:00Z,{end.isoformat()}T23:59:59Z",
        "page_size": limit,
        "sort_key": "-start_date",
    }
    try:
        resp = requests.get(
            CMR_GRANULES_URL,
            params=params,
            headers={"Client-Id": CMR_CLIENT_ID},
            timeout=CMR_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        body = resp.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning("CMR search failed: %s", exc)
        raise NisarSearchError("NASA CMR search is unavailable; try again shortly") from exc

    entries = (body.get("feed") or {}).get("entry") or []
    try:
        hits = int(resp.headers.get("CMR-Hits", len(entries)))
    except ValueError:
        hits = len(entries)
    result = {
        "product": product,
        "hits": hits,
        "granules": [parse_granule(e, product) for e in entries],
    }
    _cache_put(key, result)
    return result


def search_all_granules(
    product: str,
    *,
    polygon: list[list[float]] | None = None,
    bbox: list[float] | None = None,
    start: date | None = None,
    end: date | None = None,
    page_size: int = 2000,
) -> list[dict]:
    """Every granule of ``product`` over a polygon or bbox (all pages), oldest first.

    ``polygon`` is ``[[lon, lat], ...]``, counter-clockwise and closed, as
    CMR requires. For batch jobs (prewarming); not cached.
    """
    if product not in PRODUCTS:
        raise ValueError(f"unknown product {product!r}")
    if (polygon is None) == (bbox is None):
        raise ValueError("give exactly one of polygon or bbox")
    params = {
        "short_name[]": PRODUCTS[product]["collections"],
        "page_size": page_size,
        "sort_key": "start_date",
    }
    if polygon is not None:
        params["polygon"] = ",".join(f"{lon},{lat}" for lon, lat in polygon)
    else:
        params["bounding_box"] = ",".join(str(v) for v in bbox)
    if start or end:
        lo = f"{start.isoformat()}T00:00:00Z" if start else ""
        hi = f"{end.isoformat()}T23:59:59Z" if end else ""
        params["temporal"] = f"{lo},{hi}"

    granules, search_after = [], None
    while True:
        headers = {"Client-Id": CMR_CLIENT_ID}
        if search_after:
            headers["CMR-Search-After"] = search_after
        try:
            resp = requests.get(
                CMR_GRANULES_URL, params=params, headers=headers, timeout=60,
            )
            resp.raise_for_status()
            entries = (resp.json().get("feed") or {}).get("entry") or []
        except (requests.RequestException, ValueError) as exc:
            raise NisarSearchError(f"NASA CMR search failed: {exc}") from exc
        granules += [parse_granule(e, product) for e in entries]
        search_after = resp.headers.get("CMR-Search-After")
        if len(entries) < page_size or not search_after:
            return granules


def granule_by_title(title: str, product: str) -> dict | None:
    """The granule named ``title`` in ``product``'s collections, or ``None``.

    Lets callers name a granule instead of passing a download URL, so the
    backend only ever fetches URLs that CMR handed out.
    """
    if product not in PRODUCTS:
        raise ValueError(f"unknown product {product!r}")
    key = ("granule", product, title)
    cached = _cache_get(key)
    if cached is not _MISS:
        return cached
    params = {
        "short_name[]": PRODUCTS[product]["collections"],
        "readable_granule_name[]": title,
        "page_size": 1,
    }
    try:
        resp = requests.get(
            CMR_GRANULES_URL,
            params=params,
            headers={"Client-Id": CMR_CLIENT_ID},
            timeout=CMR_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        entries = (resp.json().get("feed") or {}).get("entry") or []
    except (requests.RequestException, ValueError) as exc:
        logger.warning("CMR granule lookup failed: %s", exc)
        raise NisarSearchError("NASA CMR search is unavailable; try again shortly") from exc
    granule = parse_granule(entries[0], product) if entries else None
    _cache_put(key, granule)
    return granule


def browse_bounds(kml_url: str) -> list[float]:
    """``[min_lon, min_lat, max_lon, max_lat]`` of a granule's LATLON browse PNG.

    The PNG covers more ground than the granule footprint, so stretching it
    over the footprint misplaces it by up to ~0.3 degrees. Its true corners
    are in the sibling ``_LATLON.kml``. That file is public for validated
    collections only, but L2 products are gridded per track/frame, so every
    pass over a frame has the same bounds (checked against live KMLs:
    identical across cycles, within ~100 m across products). When the
    granule's own KML needs a login we use a validated granule's KML from
    the same frame. Raises ``NisarSearchError`` if neither is available.
    """
    _check_kml_url(kml_url)
    frame = _FRAME_RE.search(urlsplit(kml_url).path)
    key = ("bounds", frame.group(1) if frame else kml_url)
    bounds = _cache_get(key)
    if bounds is _MISS:
        bounds = _fetch_kml_bounds(kml_url)
        if bounds is None and frame:
            public_kml = _validated_kml_for_frame(frame.group(1))
            bounds = _fetch_kml_bounds(public_kml) if public_kml else None
        _cache_put(key, bounds)
    if bounds is None:
        raise NisarSearchError("exact browse bounds are unavailable for this granule")
    return bounds


def _check_kml_url(url):
    parts = urlsplit(url or "")
    if (
        parts.scheme != "https"
        or parts.hostname != BROWSE_HOST
        or not parts.path.endswith("_LATLON.kml")
    ):
        raise ValueError("kml must be a NISAR _LATLON.kml browse URL")


def _fetch_kml_bounds(kml_url: str) -> list[float] | None:
    try:
        resp = requests.get(
            kml_url, headers={"Client-Id": CMR_CLIENT_ID}, timeout=BOUNDS_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        coords = _KML_COORDS_RE.search(resp.text).group(1).split()
        points = [[float(v) for v in c.split(",")[:2]] for c in coords]
        lons = [p[0] for p in points]
        lats = [p[1] for p in points]
        return [min(lons), min(lats), max(lons), max(lats)]
    except (requests.RequestException, AttributeError, ValueError, IndexError) as exc:
        logger.info("Browse KML unavailable (%s): %s", kml_url, exc)
        return None


def _validated_kml_for_frame(frame: str) -> str | None:
    """KML URL of the newest validated L2 granule on ``<track>_<A|D>_<frame>``."""
    params = {
        "short_name[]": _VALIDATED_L2,
        "readable_granule_name[]": f"NISAR_L2_PR_????_???_{frame}_*",
        "options[readable_granule_name][pattern]": "true",
        "page_size": 1,
        "sort_key": "-start_date",
    }
    try:
        resp = requests.get(
            CMR_GRANULES_URL,
            params=params,
            headers={"Client-Id": CMR_CLIENT_ID},
            timeout=BOUNDS_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        entries = (resp.json().get("feed") or {}).get("entry") or []
        url = parse_granule(entries[0], "")["browse_kml_url"] if entries else None
        if url:
            _check_kml_url(url)
        return url
    except (requests.RequestException, ValueError) as exc:
        logger.info("Frame lookup failed (%s): %s", frame, exc)
        return None


def clear_cache():
    with _cache_lock:
        _cache.clear()


def parse_granule(entry: dict, product: str) -> dict:
    links = entry.get("links") or []

    def first_link(rel_suffix, suffix=None):
        for link in links:
            href = link.get("href") or ""
            if not href.startswith("https://"):
                continue
            if not (link.get("rel") or "").endswith(rel_suffix):
                continue
            if suffix and not href.endswith(suffix):
                continue
            return href
        return None

    footprint = _parse_polygon(entry.get("polygons"))
    bbox = None
    if footprint:
        lats = [p[0] for p in footprint]
        lons = [p[1] for p in footprint]
        bbox = [min(lons), min(lats), max(lons), max(lats)]

    size_mb = None
    try:
        size_mb = round(float(entry.get("granule_size")), 1)
    except (TypeError, ValueError):
        pass

    return {
        "id": entry.get("id"),
        "title": entry.get("title"),
        "product": product,
        "collection": entry.get("dataset_id"),
        "quality": _quality(entry.get("dataset_id") or ""),
        "start": entry.get("time_start"),
        "end": entry.get("time_end"),
        "size_mb": size_mb,
        "footprint": footprint,
        "bbox": bbox,
        "data_url": first_link("/data#", ".h5") or first_link("/data#"),
        "thumbnail_url": first_link("/browse#", "_thumbnail.png") or first_link("/browse#"),
        "browse_url": first_link("/browse#", "_LATLON.png"),
        "browse_kml_url": first_link("/metadata#", "_LATLON.kml"),
    }


def _quality(dataset_id: str) -> str:
    lowered = dataset_id.lower()
    for label in ("validated", "provisional", "beta"):
        if label in lowered:
            return label
    return "unknown"


def _parse_polygon(polygons) -> list[list[float]] | None:
    """CMR polygons are ``[["lat lon lat lon ..."]]``; return ``[[lat, lon], ...]``."""
    try:
        nums = [float(v) for v in polygons[0][0].split()]
    except (TypeError, IndexError, ValueError, AttributeError):
        return None
    if len(nums) < 6 or len(nums) % 2:
        return None
    return [[nums[i], nums[i + 1]] for i in range(0, len(nums), 2)]
