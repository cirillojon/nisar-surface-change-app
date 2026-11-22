"""Compute real NISAR values and image chips for the curated sites.

For every site in ``app/data/sites.json`` this script finds NISAR granules
over the site in NASA CMR, keeps a single track/frame (one viewing
geometry, so the series has no fake jumps), and reads only the pixels over
the site's bbox from each HDF5 file with HTTP range requests (a few MB per
date instead of multi-GB downloads). Pixels are resampled onto a regular
lat/lon grid over the bbox. Two products are supported:

* **GCOV** (backscatter): per date, the median HH and HV backscatter (dB)
  and the share of open-water pixels, plus an RGB image (R = HH, G = HV,
  B = HH/HV) and a lossless class mask (unobserved / observed not water /
  observed water). The open-water share that is charted (``water_pct``) is
  computed over the pixels *every* pass imaged (``shared_footprint.py``);
  each pass's share of its own pixels is kept as ``water_visible_pct``.
* **GUNW** (interferograms): the longest unbroken chain of 12-day pairs is
  corrected for the ionosphere, referenced to a stable point
  (``reference`` in ``sites.json``) and summed into cumulative
  line-of-sight displacement at the site's point, plus a displacement map
  per date.

Results go to ``app/data/nisar_observations.json`` and
``app/data/scenes/<slug>/<date>.webp``. Then run ``flask nisar load --force``.

Needs a free Earthdata Login in ``~/.netrc``::

    machine urs.earthdata.nasa.gov login <user> password <pass>

Usage (repo root, venv active, ``pip install -r requirements-data.txt``)::

    python scripts/extract_nisar.py                       # every site
    python scripts/extract_nisar.py --site punjab-crop-cycles
    python scripts/extract_nisar.py --list-frames --site punjab-crop-cycles
    python scripts/extract_nisar.py --refresh             # ignore the cache
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import numpy as np
import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app.change_types import CHANGE_TYPES  # noqa: E402
from app.nisar import CMR_CLIENT_ID, CMR_GRANULES_URL, PRODUCTS, parse_granule  # noqa: E402
# Reading and coloring are shared with the live SME2 display (app/sme2.py).
from app.nisar_render import (  # noqa: E402
    WATER_HH_DB,
    encode_webp,
    erode,
    gcov_rgb,
    open_remote,
    resample,
    target_grid,
)
from app.nisar_render import to_db as _db  # noqa: E402
import shared_footprint  # noqa: E402  (scripts/, on sys.path when run as a script)

SITES_PATH = ROOT / "app" / "data" / "sites.json"
OUT_PATH = ROOT / "app" / "data" / "nisar_observations.json"
SCENES_DIR = ROOT / "app" / "data" / "scenes"
CACHE_DIR = ROOT / "nisar-downloads" / "cache"

QUALITY_RANK = {"validated": 2, "provisional": 1}

# This site pipeline reads frequency B and requires both HH and HV. The
# selected frequency, grid spacing and polarizations remain mode-dependent.
GCOV_GRID = "science/LSAR/GCOV/grids/frequencyB"
# Dates whose valid pixels cover less of the bbox than this are skipped.
MIN_VALID_FRACTION = 0.6
EDGE_ERODE_PX = 8

GUNW_GRID = "science/LSAR/GUNW/grids/frequencyA/unwrappedInterferogram"
# Half-size (degrees) of the boxes around the site point and the reference
# point whose median phase is compared.
POINT_WINDOW_DEG = 0.01
# Diverging colors for displacement maps: away from the satellite (e.g.
# subsidence) is red, toward it (uplift) is blue.
AWAY_RGB, ZERO_RGB, TOWARD_RGB = (178, 24, 43), (247, 247, 247), (33, 102, 172)


# ─── Granule discovery ───────────────────────────────────────────────
# Granule names: NISAR_L2_PR_<TYPE>_<cycle>_<track>_<A|D>_<frame>_...
#   GCOV: ..._<frame>_<mode>_<pols>_<A|B..>_<start>_<end>_...
#   GUNW: ..._<frame>_<cycle2>_<mode>_<pol>_<refStart>_<refEnd>_<secStart>_...

def frame_key(title: str) -> str:
    """``<track>_<A|D>_<frame>``, e.g. ``034_D_073``."""
    return "_".join(title.split("_")[5:8])


def has_dual_pol_b(title: str) -> bool:
    """GCOV mode ``<bwA><bwB>_<polA><polB>`` (e.g. ``4005_DHDH``): B must be ``DH``."""
    parts = title.split("_")
    return len(parts) > 9 and parts[9][2:] == "DH"


def gunw_dates(title: str) -> tuple[str, str]:
    parts = title.split("_")
    return _iso(parts[11]), _iso(parts[13])


def _iso(stamp: str) -> str:
    return f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]}"


def search(product: str, bbox) -> list[dict]:
    resp = requests.get(
        CMR_GRANULES_URL,
        params={
            "short_name[]": PRODUCTS[product]["collections"],
            "bounding_box": ",".join(str(v) for v in bbox),
            "page_size": 2000,
            "sort_key": "start_date",
        },
        headers={"Client-Id": CMR_CLIENT_ID},
        timeout=90,
    )
    resp.raise_for_status()
    granules = [parse_granule(e, product) for e in resp.json()["feed"]["entry"]]
    granules = [g for g in granules if g["data_url"] and g["footprint"]]
    if product == "GCOV":
        granules = [g for g in granules if has_dual_pol_b(g["title"])]
    return granules


def _inside(lon, lat, poly) -> bool:
    inside = False
    for (la1, lo1), (la2, lo2) in zip(poly, poly[1:] + poly[:1]):
        if (la1 > lat) != (la2 > lat):
            if lon < lo1 + (lat - la1) * (lo2 - lo1) / (la2 - la1):
                inside = not inside
    return inside


def bbox_coverage(bbox, footprint) -> float:
    """Fraction of a 9x9 grid of points in ``bbox`` inside the footprint."""
    lons = np.linspace(bbox[0], bbox[2], 9)
    lats = np.linspace(bbox[1], bbox[3], 9)
    return sum(_inside(lo, la, footprint) for la in lats for lo in lons) / 81


def _best_per_key(granules, key):
    """One granule per ``key(g)``: validated over provisional, then newest processing."""
    best = {}
    for g in granules:
        k = key(g)
        rank = (QUALITY_RANK.get(g["quality"], 0), g["title"])
        if k not in best or rank > best[k][0]:
            best[k] = (rank, g)
    return {k: v[1] for k, v in best.items()}


def gcov_series(granules) -> list[dict]:
    by_day = _best_per_key(granules, lambda g: g["start"][:10])
    return [by_day[d] for d in sorted(by_day)]


def gunw_chain(granules) -> list[dict]:
    """Longest run of pairs where each pair starts on the date the previous one ends."""
    pairs = _best_per_key(granules, lambda g: gunw_dates(g["title"]))
    starting = defaultdict(list)
    for (ref, sec), g in pairs.items():
        starting[ref].append((sec, g))

    @lru_cache(maxsize=None)
    def longest(day):
        options = [[g] + longest(sec) for sec, g in starting.get(day, [])]
        return max(options, key=len, default=[])

    return max((longest(day) for day in starting), key=len, default=[])


def pick_frame(site, product, granules):
    """Best frame for a site → ``(frame, ordered granules)``."""
    by_frame = defaultdict(list)
    for g in granules:
        by_frame[frame_key(g["title"])].append(g)
    order = gcov_series if product == "GCOV" else gunw_chain

    must_see = [(site["longitude"], site["latitude"])]
    if site.get("reference"):
        must_see.append(tuple(site["reference"]))

    def score(frame):
        rows = by_frame[frame]
        cover = max(bbox_coverage(site["bbox"], g["footprint"]) for g in rows)
        sees = all(any(_inside(lo, la, g["footprint"]) for g in rows) for lo, la in must_see)
        return (sees and cover >= 0.9, len(order(rows)), cover)

    if site.get("frame"):
        frame = site["frame"]
    elif by_frame:
        frame = max(by_frame, key=score)
    else:
        return None, []
    return frame, order(by_frame.get(frame, []))


# ─── Images ──────────────────────────────────────────────────────────

def save_webp(path: Path, rgb: np.ndarray, valid: np.ndarray):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encode_webp(rgb, valid))


# ─── GCOV ────────────────────────────────────────────────────────────

def gcov_scene(slug: str, bbox, granule: dict) -> dict:
    h5, fobj = open_remote(granule["data_url"])
    with h5:
        if GCOV_GRID not in h5:
            return {"skip": "no frequency B grid"}
        grid = h5[GCOV_GRID]
        pols = {p.decode() for p in grid["listOfPolarizations"][()]}
        if not {"HH", "HV"} <= pols:
            return {"skip": f"frequency B has {sorted(pols)}, need HH+HV"}
        px = resample(grid, bbox, {"HHHH": np.nan, "HVHV": np.nan, "mask": 255})
    if px is None:
        return {"skip": "bbox outside grid"}
    hh, hv = px["HHHH"], px["HVHV"]
    # mask: 0 = partially focused, 255 = outside the swath, else subswath id.
    valid = (px["mask"] != 0) & (px["mask"] != 255) & (hh > 0) & (hv > 0)
    # Pixels along the swath edge are often anomalously bright.
    valid = erode(valid, EDGE_ERODE_PX)
    valid_fraction = float(valid.mean())
    if valid_fraction < MIN_VALID_FRACTION:
        return {"skip": f"only {valid_fraction:.0%} of bbox valid"}

    day = granule["start"][:10]
    image = f"{slug}/{day}.webp"
    save_webp(SCENES_DIR / image, gcov_rgb(hh, hv), valid)
    # Unobserved pixels stay unobserved: never counted as dry or wet.
    with np.errstate(divide="ignore", invalid="ignore"):
        water = valid & (_db(hh) < WATER_HH_DB)
    mask = f"{slug}/{day}.mask.png"
    shared_footprint.write_mask(SCENES_DIR / mask, shared_footprint.classes(valid, water))
    # Median, not mean: a few very bright pixels (buildings, double-bounce
    # from flooded trees) would otherwise dominate a site's average.
    hh_db, hv_db = _db(hh[valid]), _db(hv[valid])
    return {
        "date": day,
        "granule_id": granule["title"],
        "quality": granule["quality"],
        "valid_pct": round(valid_fraction * 100, 1),
        "values": {
            "hh_db": round(float(np.median(hh_db)), 2),
            "hv_db": round(float(np.median(hv_db)), 2),
            # Share of this pass's own pixels; water_pct (shared footprint)
            # is added once every pass is in (run_gcov).
            "water_visible_pct": round(float(water.sum() / valid.sum() * 100), 1),
        },
        "image": image,
        "mask": mask,
        "mb_read": round(fobj.bytes_read / 1e6, 1),
    }


def run_gcov(site, frame, granules, previous, workers, refresh):
    slug, bbox = site["slug"], site["bbox"]
    keep = {} if refresh or previous.get("frame") != frame else {
        s["granule_id"]: s for s in previous.get("scenes", [])
    }
    todo = [g for g in granules if g["title"] not in keep]
    print(f"  {len(granules)} dates, {len(todo)} new", flush=True)
    results = dict(keep)
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(gcov_scene, slug, bbox, g) for g in todo]
        for g, fut in zip(todo, futures):
            try:
                res = fut.result()
            except Exception as exc:  # noqa: BLE001 — report and keep going
                print(f"  {g['start'][:10]} FAILED: {exc}", flush=True)
                continue
            if "skip" in res:
                print(f"  {g['start'][:10]} skipped: {res['skip']}", flush=True)
                continue
            mb = res.pop("mb_read")
            print(f"  {res['date']} {res['values']} ({mb} MB)", flush=True)
            results[g["title"]] = res
    entry = {
        "product": "GCOV",
        "frame": frame,
        "scenes": sorted(results.values(), key=lambda s: s["date"]),
    }
    if entry["scenes"]:
        # Exact masks when every pass has one (passes kept from an older run
        # may not): otherwise the committed images, calibrated per pass.
        fp = shared_footprint.apply_site(entry, slug, SCENES_DIR)
        print(f"  shared footprint: {fp['pct_of_box']}% of the box ({fp['method']}, {fp['status']})",
              flush=True)
    return entry


# ─── GUNW ────────────────────────────────────────────────────────────

def gunw_pixels(slug: str, bbox, granule: dict, refresh: bool) -> dict:
    """Resampled phase, ionosphere, components and coherence for one pair (cached)."""
    cache = CACHE_DIR / slug / f"{granule['title']}.npz"
    if cache.exists() and not refresh:
        data = np.load(cache)
        if np.allclose(data["bbox"], bbox):
            return {k: data[k] for k in data.files}
    h5, _ = open_remote(granule["data_url"])
    with h5:
        group = h5[GUNW_GRID]
        wavelength = 299_792_458.0 / float(
            h5["science/LSAR/GUNW/grids/frequencyA/centerFrequency"][()]
        )
        px = resample(group, bbox, {
            "HH/unwrappedPhase": np.nan,
            "HH/ionospherePhaseScreen": np.nan,
            "HH/connectedComponents": 0,
            "HH/coherenceMagnitude": np.nan,
        })
    if px is None:
        raise ValueError("bbox outside grid")
    px["wavelength"] = np.float64(wavelength)
    px["bbox"] = np.asarray(bbox, dtype=float)
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cache, **px)
    return px


def _window(lon, lat, point):
    return (np.abs(lon - point[0]) <= POINT_WINDOW_DEG) & (np.abs(lat - point[1]) <= POINT_WINDOW_DEG)


def displacement_rgb(disp, limit):
    """Diverging map: red = away from the satellite, blue = toward it."""
    t = np.clip(np.nan_to_num(disp) / limit, -1, 1)[..., None]
    zero, away, toward = (np.array(c, dtype=float) for c in (ZERO_RGB, AWAY_RGB, TOWARD_RGB))
    return np.where(t < 0, zero + (away - zero) * -t, zero + (toward - zero) * t)


def run_gunw(site, frame, granules, previous, workers, refresh):
    slug, bbox = site["slug"], site["bbox"]
    if not site.get("reference"):
        raise SystemExit(f"{slug}: GUNW sites need a stable 'reference': [lon, lat]")
    print(f"  {len(granules)} pairs in the chain", flush=True)
    with ProcessPoolExecutor(max_workers=workers) as pool:
        pixels = list(pool.map(
            gunw_pixels, [slug] * len(granules), [bbox] * len(granules), granules,
            [refresh] * len(granules),
        ))

    lon, lat = target_grid(bbox)
    ref_win = _window(lon, lat, site["reference"])
    site_win = _window(lon, lat, (site["longitude"], site["latitude"]))
    first_day = gunw_dates(granules[0]["title"])[0]
    total = np.zeros(lon.shape)
    seen = np.zeros(lon.shape, dtype=int)
    point_total = 0.0
    frames = [(first_day, None, total.copy(), seen.copy(), 0.0, None)]
    for g, px in zip(granules, pixels):
        cc = px["connectedComponents"]
        ref_cc = cc[ref_win & (cc > 0)]
        if ref_cc.size == 0:
            print(f"  {gunw_dates(g['title'])} reference not unwrapped; pair counted as 0",
                  flush=True)
            valid = np.zeros(lon.shape, dtype=bool)
            disp = np.zeros(lon.shape)
        else:
            # Phase is only comparable within the reference's connected component.
            valid = cc == np.bincount(ref_cc).argmax()
            phase = px["unwrappedPhase"] - px["ionospherePhaseScreen"]
            valid &= np.isfinite(phase)
            # +phase maps to negative LOS displacement (+ toward, - away).
            # Checked against known subsidence (Mexico City) and uplift
            # (Campi Flegrei); the Handbook's generic phase equation alone
            # does not fix the product-specific sign.
            disp = -phase * float(px["wavelength"]) / (4 * np.pi) * 1000.0
            disp -= np.median(disp[ref_win & valid])
            disp = np.where(valid, disp, 0.0)
        at_site = disp[site_win & valid]
        step = float(np.median(at_site)) if at_site.size else 0.0
        point_total += step
        total += disp
        seen += valid
        coherence = px["coherenceMagnitude"][site_win]
        frames.append((
            gunw_dates(g["title"])[1], g, total.copy(), seen.copy(), point_total,
            float(np.nanmedian(coherence)) if np.isfinite(coherence).any() else None,
        ))

    n_pairs = len(granules)
    reliable = seen >= 0.8 * n_pairs
    limit = float(np.percentile(np.abs(total[reliable]), 98)) if reliable.any() else 10.0
    limit = max(10.0, math.ceil(limit / 10.0) * 10.0)

    scenes = []
    for i, (day, g, cum, count, point, coherence) in enumerate(frames):
        image = f"{slug}/{day}.webp"
        # A pixel is shown once it has been unwrapped in >= 80% of pairs so far.
        shown = count >= 0.8 * i if i else np.ones(lon.shape, dtype=bool)
        shown &= reliable
        save_webp(SCENES_DIR / image, displacement_rgb(cum, limit), shown)
        values = {"los_mm": round(point, 1)}
        if coherence is not None:
            values["coherence"] = round(coherence, 2)
        scenes.append({
            "date": day,
            "granule_id": g["title"] if g else None,
            "quality": g["quality"] if g else None,
            "valid_pct": round(float(shown.mean()) * 100, 1),
            "values": values,
            "image": image,
        })
        print(f"  {day} {values}", flush=True)
    return {
        "product": "GUNW",
        "frame": frame,
        "reference": site["reference"],
        "image_range_mm": limit,
        "scenes": scenes,
    }


# ─── Main ────────────────────────────────────────────────────────────

def load_output() -> dict:
    if OUT_PATH.exists():
        return json.loads(OUT_PATH.read_text(encoding="utf-8"))
    return {"sites": {}}


def save_output(data: dict):
    meta = {
        "_note": (
            "REAL values derived from NISAR granules by scripts/extract_nisar.py. "
            "Regenerate with that script; do not edit by hand. "
            "Images are in app/data/scenes/."
        ),
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "method": {
            "GCOV": shared_footprint.GCOV_METHOD,
            "GUNW": (
                "Longest unbroken chain of 12-day pairs on one frame. Unwrapped "
                "phase minus the ionosphere phase screen, converted to mm with "
                "-wavelength/(4*pi) (positive = toward the satellite), relative to "
                f"the median of a +/-{POINT_WINDOW_DEG} deg box at the reference point "
                "and summed. los_mm: median of the same box at the site point. "
                "Image: cumulative displacement, red = away, blue = toward, "
                "+/- image_range_mm."
            ),
        },
    }
    ordered = {**meta, "sites": dict(sorted(data["sites"].items()))}
    OUT_PATH.write_text(json.dumps(ordered, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def site_product(site) -> str:
    return site.get("product") or CHANGE_TYPES[site["change_type"]]["product"]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--site", action="append", help="Only this slug (repeatable).")
    parser.add_argument("--refresh", action="store_true", help="Recompute and refetch everything.")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--list-frames", action="store_true", help="Show candidate frames and exit.")
    args = parser.parse_args(argv)

    sites = json.loads(SITES_PATH.read_text(encoding="utf-8"))["sites"]
    if args.site:
        unknown = set(args.site) - {s["slug"] for s in sites}
        if unknown:
            parser.error(f"unknown site(s): {sorted(unknown)}")
        sites = [s for s in sites if s["slug"] in args.site]

    out = load_output()
    # Drop results for sites no longer in sites.json.
    known = {s["slug"] for s in json.loads(SITES_PATH.read_text(encoding="utf-8"))["sites"]}
    out["sites"] = {k: v for k, v in out["sites"].items() if k in known}

    for site in sites:
        slug, product = site["slug"], site_product(site)
        granules = search(product, site["bbox"])
        if args.list_frames:
            by_frame = defaultdict(list)
            for g in granules:
                by_frame[frame_key(g["title"])].append(g)
            for frame, rows in sorted(by_frame.items(), key=lambda kv: -len(kv[1])):
                ordered = gcov_series(rows) if product == "GCOV" else gunw_chain(rows)
                cover = max(bbox_coverage(site["bbox"], g["footprint"]) for g in rows)
                print(f"{slug} {product} {frame}: {len(ordered)} usable "
                      f"{'dates' if product == 'GCOV' else 'chained pairs'}, "
                      f"bbox coverage {cover:.0%}")
            continue

        frame, ordered = pick_frame(site, product, granules)
        print(f"{slug}: {product} frame {frame}", flush=True)
        if not ordered:
            print("  no usable granules; skipping", flush=True)
            continue
        runner = run_gcov if product == "GCOV" else run_gunw
        result = runner(site, frame, ordered, out["sites"].get(slug, {}), args.workers,
                        args.refresh)
        wanted = {s["image"] for s in result["scenes"]} | {
            s["mask"] for s in result["scenes"] if s.get("mask")
        }
        for pattern in ("*.webp", "*.mask.png"):
            for stale in (SCENES_DIR / slug).glob(pattern):
                if f"{slug}/{stale.name}" not in wanted:
                    stale.unlink()
        out["sites"][slug] = result
        save_output(out)


if __name__ == "__main__":
    main()
