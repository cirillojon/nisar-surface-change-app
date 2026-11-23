"""Where and when NISAR has imaged the Earth: a global coverage grid.

Pages through every NISAR granule in NASA CMR (no login needed) for each
product the app searches (``app.nisar.PRODUCTS``), and counts, per 1° cell
and calendar month, how many passes imaged the cell. The output,
``app/data/coverage_map.npz``, is what ``/api/nisar/coverage-map`` serves
(``app/coverage_map.py``) and the workspace's coverage heatmap draws.

How a granule becomes counts:

* CMR's KML listing gives each granule's name and footprint polygon in
  ~0.5 s per 2,000 granules (the JSON listing is ~50x larger).
* The name gives the track, orbit direction (A/D) and the acquisition
  date(s) (``app.nisar.granule_name_metadata``). Pair products (GUNW,
  GOFF) are dated by their later (secondary) acquisition: the pair exists
  from then on.
* A footprint covers the cells whose centers fall inside it, or the cell
  holding its center if it is smaller than one cell.
* A **pass** is one track and direction on one UTC day (for pairs: one
  reference and secondary day). Granules of the same pass (adjacent
  frames, several frequencies or modes, validated and provisional copies)
  count once per cell.

Per product and month the file holds three ``[month, 180, 360]`` arrays
(row 0 is 89–90°N, column 0 is 180–179°W):

* ``<product>_passes``: passes over the cell in the month;
* ``<product>_asc``: how many of them were ascending;
* ``<product>_last``: day of the month of the latest one (0: none).

Usage (repo root, venv active; ~5-10 min, all public)::

    python scripts/build_coverage_map.py
    python scripts/build_coverage_map.py --products GCOV,GUNW
    python scripts/build_coverage_map.py --cache /tmp/cmr-kml   # reuse listings
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import re
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app.nisar import CMR_CLIENT_ID, PRODUCTS, granule_name_metadata  # noqa: E402

OUT_PATH = ROOT / "app" / "data" / "coverage_map.npz"
CMR_KML_URL = "https://cmr.earthdata.nasa.gov/search/granules.kml"
PAGE_SIZE = 2000
CELL_DEG = 1
ROWS, COLS = 180 // CELL_DEG, 360 // CELL_DEG
PAIR_PRODUCTS = {"GUNW", "GOFF"}

_PLACEMARK_RE = re.compile(
    r"<Placemark><name>([^<]+)</name>.*?<coordinates>([^<]+)</coordinates>", re.S,
)
_STAMP_RE = re.compile(r"_(\d{8})T\d{6}")


def fetch_collection(short_name: str, cache: Path | None = None) -> list[tuple[str, str]]:
    """``[(granule name, "lon,lat lon,lat ..."), ...]`` for every granule in a collection."""
    cached = cache / f"{short_name}.tsv.gz" if cache else None
    if cached and cached.is_file():
        with gzip.open(cached, "rt", encoding="utf-8") as fh:
            return [tuple(line.rstrip("\n").split("\t", 1)) for line in fh if "\t" in line]

    # CMR's KML listing has no search-after cursor, so pages are numbered,
    # sorted by the unique granule UR so they don't shift between requests.
    seen: dict[str, str] = {}
    page = 1
    while True:
        params = {
            "short_name": short_name, "page_size": PAGE_SIZE, "page_num": page,
            "sort_key": "granule_ur",
        }
        for attempt in range(4):
            try:
                resp = requests.get(
                    CMR_KML_URL, params=params, headers={"Client-Id": CMR_CLIENT_ID}, timeout=120,
                )
                resp.raise_for_status()
                break
            except requests.RequestException as exc:
                if attempt == 3:
                    raise
                print(f"  {short_name}: retrying page {page} ({exc})", file=sys.stderr)
                time.sleep(5 * (attempt + 1))
        found = _PLACEMARK_RE.findall(resp.text)
        for name, coords in found:
            seen[name.strip()] = coords.strip()
        if page % 10 == 0:
            print(f"  {short_name}: {len(seen):,} granules", file=sys.stderr)
        if len(found) < PAGE_SIZE:
            break
        page += 1
    rows = list(seen.items())

    if cached:
        cached.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(cached, "wt", encoding="utf-8") as fh:
            fh.writelines(f"{name}\t{coords}\n" for name, coords in rows)
    return rows


def parse_coords(text: str) -> list[tuple[float, float]]:
    """KML ``"lon,lat[,alt] lon,lat ..."`` → ``[(lon, lat), ...]``."""
    points = []
    for item in text.split():
        parts = item.split(",")
        if len(parts) >= 2:
            points.append((float(parts[0]), float(parts[1])))
    return points


def _inside(x: float, y: float, ring: list[tuple[float, float]]) -> bool:
    """Ray casting: is (x, y) inside the closed or open ``ring``?"""
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def cells_of(ring: list[tuple[float, float]]) -> frozenset[int]:
    """Grid cells (``row * COLS + col``) whose centers lie inside the footprint.

    A footprint crossing the antimeridian is unwrapped to 0–360° first. One
    smaller than a cell gets the cell holding its center.
    """
    if len(ring) < 3:
        return frozenset()
    lons = [p[0] for p in ring]
    if max(lons) - min(lons) > 180:
        ring = [(lon + 360 if lon < 0 else lon, lat) for lon, lat in ring]
        lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    c0, c1 = math.floor(min(lons) / CELL_DEG), math.floor(max(lons) / CELL_DEG)
    r0, r1 = math.floor(min(lats) / CELL_DEG), math.floor(max(lats) / CELL_DEG)
    if (c1 - c0 + 1) * (r1 - r0 + 1) > 5000:  # not a frame; never seen in practice
        return frozenset()
    cells = set()
    for r in range(r0, r1 + 1):
        y = (r + 0.5) * CELL_DEG
        for c in range(c0, c1 + 1):
            if _inside((c + 0.5) * CELL_DEG, y, ring):
                cells.add(_cell(r * CELL_DEG, c * CELL_DEG))
    if not cells:
        cells.add(_cell(sum(lats) / len(lats), sum(lons) / len(lons)))
    return frozenset(cells)


def _cell(lat: float, lon: float) -> int:
    row = min(ROWS - 1, max(0, math.floor((90 - lat) / CELL_DEG - 1e-9)))
    lon = ((lon + 180) % 360) - 180
    col = min(COLS - 1, max(0, math.floor((lon + 180) / CELL_DEG)))
    return row * COLS + col


def pass_of(title: str, product: str) -> tuple | None:
    """``(track, direction, dates)`` of a granule, where ``dates[-1]`` is the day it is counted on.

    Pair products keep both dates, so each pair counts once; other products
    keep only the acquisition day. ``None`` for names that don't parse.
    """
    meta = granule_name_metadata(title)
    if not meta["track"] or not meta["orbit_direction"]:
        return None
    try:
        days = sorted({datetime.strptime(s, "%Y%m%d").date() for s in _STAMP_RE.findall(title)})
    except ValueError:
        return None
    if not days:
        return None
    dates = (days[0], days[-1]) if product in PAIR_PRODUCTS else (days[-1],)
    return meta["track"], meta["orbit_direction"], dates


def aggregate(granules_by_product: dict[str, list[tuple[str, str]]], today: date):
    """Count passes per product, month and cell. Returns ``(months, arrays, stats)``."""
    passes: dict[str, dict[tuple, set[int]]] = {}
    cell_cache: dict[str, frozenset[int]] = {}
    first = None
    for product, rows in granules_by_product.items():
        groups: dict[tuple, set[int]] = defaultdict(set)
        for title, coords in rows:
            key = pass_of(title, product)
            if key is None:
                continue
            cells = cell_cache.get(coords)
            if cells is None:
                cells = cell_cache[coords] = cells_of(parse_coords(coords))
            groups[key] |= cells
            day = key[2][-1]
            first = day if first is None or day < first else first
        passes[product] = groups

    if first is None:
        raise SystemExit("CMR returned no NISAR granules")
    months = []
    y, m = first.year, first.month
    while (y, m) <= (today.year, today.month):
        months.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    month_index = {mo: i for i, mo in enumerate(months)}

    arrays, stats = {}, {}
    for product, groups in passes.items():
        count = np.zeros((len(months), ROWS * COLS), dtype=np.uint16)
        asc = np.zeros_like(count)
        last = np.zeros((len(months), ROWS * COLS), dtype=np.uint8)
        for (_track, direction, dates), cells in groups.items():
            day = dates[-1]
            mi = month_index.get(f"{day.year:04d}-{day.month:02d}")
            if mi is None or not cells:
                continue
            idx = np.fromiter(cells, dtype=np.int64)
            count[mi, idx] = np.minimum(count[mi, idx].astype(np.uint32) + 1, 65535)
            if direction == "A":
                asc[mi, idx] += 1
            last[mi, idx] = np.maximum(last[mi, idx], day.day)
        arrays[f"{product}_passes"] = count.reshape(len(months), ROWS, COLS)
        arrays[f"{product}_asc"] = asc.reshape(len(months), ROWS, COLS)
        arrays[f"{product}_last"] = last.reshape(len(months), ROWS, COLS)
        stats[product] = {
            "granules": len(granules_by_product[product]),
            "passes": len(groups),
            "cells": int((count.sum(axis=0) > 0).sum()),
            "unit": "pairs" if product in PAIR_PRODUCTS else "passes",
        }
    return months, arrays, stats


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--products", default=",".join(PRODUCTS),
                        help="comma-separated products (default: all)")
    parser.add_argument("--cache", type=Path, default=None,
                        help="directory to keep and reuse the CMR listings")
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    args = parser.parse_args(argv)

    products = [p.strip() for p in args.products.split(",") if p.strip()]
    unknown = [p for p in products if p not in PRODUCTS]
    if unknown:
        parser.error(f"unknown products: {', '.join(unknown)}")

    started = time.monotonic()
    collections = [(p, c) for p in products for c in PRODUCTS[p]["collections"]]
    with ThreadPoolExecutor(max_workers=3) as pool:
        listings = list(pool.map(lambda pc: fetch_collection(pc[1], args.cache), collections))
    by_product: dict[str, list] = defaultdict(list)
    for (product, collection), rows in zip(collections, listings):
        print(f"{collection}: {len(rows):,} granules", file=sys.stderr)
        by_product[product] += rows

    now = datetime.now(timezone.utc)
    months, arrays, stats = aggregate(dict(by_product), now.date())
    meta = {
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "NASA CMR granule listings (KML footprints), all NISAR collections in app/nisar.py",
        "cell_deg": CELL_DEG,
        "months": months,
        "products": stats,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.out, meta=np.array(json.dumps(meta)), **arrays)
    size_kb = args.out.stat().st_size / 1024
    print(json.dumps(stats, indent=2), file=sys.stderr)
    print(f"Wrote {args.out} ({size_kb:.0f} KB, {len(months)} months) in "
          f"{time.monotonic() - started:.0f} s", file=sys.stderr)


if __name__ == "__main__":
    main()
