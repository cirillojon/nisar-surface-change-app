"""Build the land-change gallery: NISAR radar images of places whose surface
visibly changed during NISAR's record.

For each site in ``SITES`` this script takes every GCOV (backscatter) pass on
one track/frame, reads only a window around the site at frequency A (~20 m),
and writes per pass:

* ``<date>.webp``: what the map shows: false colour (R = HH, G = HV,
  B = HH/HV, the crop sites' stretches) or HH grey when HV is missing;
* ``<date>.hh.png``: HH brightness in dB at half resolution, 8-bit
  (dB -30..+5 → 0..254, 255 = no data). The browser computes a change map
  between any two dates from these.

Writes ``app/data/landchange.json`` and
``app/data/scenes/landchange/<slug>/``. Sites listed in ``NOT_VISIBLE`` were
checked the same way and are shown with the reason.

Needs ``EARTHDATA_TOKEN`` (or ~/.netrc). Usage (repo root, venv active)::

    python scripts/build_landchange.py            # every site
    python scripts/build_landchange.py --only kilauea
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pyproj
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app import nisar  # noqa: E402
from app.nisar_render import encode_webp, gcov_rgb, open_remote  # noqa: E402

OUT_PATH = ROOT / "app" / "data" / "landchange.json"
IMAGE_DIR = ROOT / "app" / "data" / "scenes" / "landchange"
GRID = "science/LSAR/GCOV/grids/frequencyA"
PIX_M = 20.0          # finest pixel (frequency A posting)
MAX_PX = 450          # longest image side (a site may set "max_px")
DB_LO, DB_HI = -30.0, 5.0
MIN_VALID = 0.5       # skip passes with less of the window imaged

SITES = {
    "kilauea": {
        "name": "Kīlauea summit", "region": "Hawaiʻi, USA", "kind": "Volcano",
        "status": "visible", "lon": -155.28, "lat": 19.405, "half_km": 3.0,
        "headline": "Lava refills Halemaʻumaʻu crater",
        "story": "Dozens of short lava-fountaining episodes in Halemaʻumaʻu crater through 2025-26, each adding lava to the crater floor.",
        "look_for": "The crater floor changing as new lava covers it, and tephra to the southwest.",
        "sources": [
            ["USGS HVO: Kīlauea episode maps",
             "https://www.usgs.gov/observatories/hvo/news/new-maps-february-19-2026-kilauea-episode-42-deposits-and-deformation"],
            ["NASA: Restless Kīlauea", "https://science.nasa.gov/earth/earth-observatory/restless-kilauea-launches-lava-and-ash/"],
        ],
    },
    # Not in the gallery ("hidden"): sharp imagery for the guided tour's drawn
    # box, so the tour shows the same renders as the gallery, not browse images.
    "kilauea-tour": {
        "name": "Kīlauea summit (tour)", "region": "Hawaiʻi, USA", "kind": "Volcano",
        "status": "visible", "hidden": True, "lon": -155.2825, "lat": 19.405,
        "half_km": 6.0, "max_px": 600,
        "headline": "The tour's view of Kīlauea",
        "story": "The area the guided tour has you draw, rendered like the gallery's images.",
        "look_for": "The caldera and its crater floor.",
        "sources": [],
    },
    "krasheninnikov": {
        "name": "Krasheninnikov volcano", "region": "Kamchatka, Russia", "kind": "Volcano",
        "status": "visible", "lon": 160.273, "lat": 54.593, "half_km": 6.0,
        "headline": "A new lava flow down the south flank",
        "story": (
            "Krasheninnikov, quiet for centuries, erupted in 2025-26 and sent lava "
            "flows down its flanks."
        ),
        "look_for": "A long, bright flow running south from the summit area that isn't there in June.",
        "sources": [["Space.com: Satellite spies an erupting volcano",
                     "https://www.space.com/astronomy/earth/satellite-spies-an-erupting-volcano-space-photo-of-the-day-for-march-13-2026"]],
    },
    "jakobshavn": {
        "name": "Jakobshavn Isbræ", "region": "Greenland", "kind": "Glacier",
        "status": "visible", "lon": -49.85, "lat": 69.17, "half_km": 14.0,
        "headline": "The ice in the fjord changes from June to October",
        "story": "Greenland's fastest glacier, flowing tens of metres a day into an ice-packed fjord.",
        "look_for": "The glacier front and the fjord's ice, pass by pass.",
        "sources": [],
    },
    "jamuna": {
        "name": "Jamuna River", "region": "Bangladesh", "kind": "River",
        "status": "visible", "lon": 89.70, "lat": 24.30, "half_km": 12.0,
        "headline": "Channels and sandbars look different after the monsoon",
        "story": "A braided river whose channels and sandbars shift every monsoon.",
        "look_for": "Where water (dark) and sand (bright) sit in June and in November.",
        "sources": [],
    },
    "langtang": {
        "name": "Langtang Lirung slope collapse", "region": "Nepal–China border", "kind": "Landslide",
        "status": "likely", "lon": 85.51, "lat": 28.31, "half_km": 6.0,
        "event": {"date": "2026-08-26", "label": "Rock slope failure and debris flow"},
        "headline": "A streak of change between the passes either side of 26 August",
        "story": "On 26 August 2026 a very large rock slope on Langtang Lirung failed and started a debris flow and flood that swept through Nepal and Tibet.",
        "look_for": "A streak of strong change between 19 and 31 August, absent from the pairs before and after, starting about half a kilometre from the reported source (28.29°N, 85.53°E) and running northwest down the valley. Consistent with the debris flow; not a mapped outline of it.",
        "suggested": ["2026-08-19", "2026-08-31"],
        "sources": [["Eos Landslide Blog: the landslide behind the 26 August debris flow",
                      "https://eos.org/thelandslideblog/nepal-tibet-2"],
                     ["Eos Landslide Blog: Langtang Lirung",
                      "https://eos.org/thelandslideblog/langtang-lirung-1"],
                     ["2026 Nepal–Tibet floods (Wikipedia)",
                      "https://en.wikipedia.org/wiki/2026_Nepal_floods"],
                     ["CNN, 26 Aug 2026",
                      "https://www.cnn.com/2026/08/26/world/live-news/nepal-flash-flooding-floods-intl"]],
    },
    "anak-krakatau": {
        "name": "Anak Krakatau", "region": "Sunda Strait, Indonesia", "kind": "Volcanic island",
        "status": "likely", "lon": 105.423, "lat": -6.102, "half_km": 2.5,
        "event": {"date": "2026-09-30", "label": "Eruption; new islets reported"},
        "headline": "New features on the west coast after the eruption",
        "story": "After a late-September 2026 eruption, officials reported two small new formations around the island.",
        "look_for": "A new bright feature on the west coast on 30 September. Small for 20 m pixels.",
        "suggested": ["2026-09-18", "2026-09-30"],
        "sources": [["Japan Times, 2 Oct 2026",
                     "https://www.japantimes.co.jp/news/2026/10/02/asia-pacific/indonesia-new-islands-volcano-eruption/"]],
    },
}

SITES.update({
    "etna": {
        "name": "Etna", "region": "Sicily, Italy", "kind": "Volcano",
        "status": "visible", "lon": 15.02, "lat": 37.745, "half_km": 5.0,
        "event": {"date": "2026-06-26", "label": "Lava flow reported toward the Valle del Leone"},
        "headline": "A ribbon of change where a lava flow was reported",
        "story": "On 26 June 2026 a lava flow was reported moving toward the Valle del Leone from a fracture at about 3,000 m.",
        "look_for": "A ribbon of change east-northeast of the summit, clearest from 17 June to 27 October.",
        "suggested": ["2026-06-17", "2026-10-27"],
        # A tour operator's blog; it quotes INGV's statement of the same day.
        "sources": [["Go Etna, 26 Jun 2026 (quotes INGV's statement)",
                     "https://www.go-etna.com/blog/etna-lights-up-the-summer-of-2026-with-a-new-eruption/"]],
    },
    "rio-branco": {
        "name": "Rio Branco at Caracaraí", "region": "Roraima, Brazil", "kind": "River",
        "status": "visible", "lon": -61.13, "lat": 1.82, "half_km": 15.0,
        "headline": "Bright streaks appear along the river as the scene darkens",
        "story": "An Amazon tributary whose level normally falls through the second half of the year.",
        "look_for": "Bright streaks along the channel from June to October, and the whole scene getting darker.",
        "sources": [],
    },
    "budhi-gandaki": {
        "name": "Budhi Gandaki landslide", "region": "Gorkha, Nepal", "kind": "Landslide",
        "status": "likely", "lon": 84.9345, "lat": 28.5336, "half_km": 3.0,
        "event": {"date": "2026-10-11", "label": "Landslide and debris flow"},
        "headline": "A fresh patch of change at the reported scar",
        "story": "On 11 October 2026 a rock slope failed (source area about 500 by 850 m) and ran down the valley as a debris flow.",
        "look_for": "A compact patch of change at the scar's reported position, 6 to 18 October.",
        "suggested": ["2026-10-06", "2026-10-18"],
        "sources": [["Eos Landslide Blog (D. Petley), 5 Nov 2026", "https://eos.org/thelandslideblog/budhi-gandaki-2"]],
    },
    "bang-pakong": {
        "name": "Bang Pakong River floods", "region": "Chachoengsao, Thailand", "kind": "Flood",
        "status": "likely", "lon": 101.07, "lat": 13.69, "half_km": 15.0,
        "event": {"date": "2026-10-01", "label": "Floods along the Bang Pakong River"},
        "headline": "Dark patches spread across fields",
        "story": "October 2026 rains flooded farmland and fish ponds along the river east of Bangkok.",
        "look_for": "Dark patches across the fields, 30 September to 12 October, as standing water would look.",
        "suggested": ["2026-09-30", "2026-10-12"],
        "sources": [["NASA: Floodwaters Overwhelm Thailand",
                     "https://science.nasa.gov/earth/earth-observatory/floodwaters-overwhelm-thailand/"]],
    },
})

NOT_VISIBLE = [
    {"slug": "home-reef", "name": "Home Reef", "region": "Tonga", "kind": "Volcanic island",
     "reason": "The island (over 1 km across in 2025) looks the same in every pass Jun–Oct 2026."},
    {"slug": "nishinoshima", "name": "Nishinoshima", "region": "Japan", "kind": "Volcanic island",
     "reason": "No visible change Jun–Oct 2026."},
    {"slug": "mayon", "name": "Mayon", "region": "Philippines", "kind": "Volcano",
     "reason": "Its 2026 lava flows came before NISAR's regular coverage here (from June); no change since."},
    {"slug": "titan-ridge", "name": "Titan Ridge eruption", "region": "Bismarck Sea, Papua New Guinea",
     "kind": "Submarine volcano",
     "reason": "Open sea in every pass: no new island has surfaced (as of Oct 2026)."},
    {"slug": "caspian-kulaly", "name": "Northern Caspian shoreline", "region": "Kazakhstan", "kind": "Coast",
     "reason": "Real retreat over years, but nothing resolvable between June and October 2026."},
    {"slug": "fournaise", "name": "Piton de la Fournaise lava delta", "region": "Réunion", "kind": "Volcano",
     "reason": "Lava reached the sea in March 2026, before NISAR covered it; only one pass per track since."},
    # No GCOV granule reaches 77.7°N in NASA CMR (checked 15 Nov 2026): NISAR looks to one side.
    {"slug": "petermann", "name": "Petermann Glacier", "region": "Greenland", "kind": "Glacier",
     "reason": "Outside NISAR's coverage: its images end just short of 77.7°N, and Petermann is at 81°N."},
    {"slug": "thunder-bay-36", "name": "Thunder Bay 36 wildfire", "region": "Ontario, Canada", "kind": "Wildfire",
     "reason": "No clear burn-scar edge in the area screened."},
    {"slug": "palm-jebel-ali", "name": "Palm Jebel Ali", "region": "Dubai, UAE", "kind": "Construction",
     "reason": "Only the sea surface changed (wind); the palm's outline looks the same June–October."},
    {"slug": "neom-line", "name": "NEOM, The Line", "region": "Saudi Arabia", "kind": "Construction",
     "reason": "No visible change in the construction areas screened, June–October."},
    {"slug": "gandak", "name": "Gandak River floods", "region": "India / Nepal", "kind": "Flood",
     "reason": "Only an area-wide brightening in September (wet season), no distinct flood edges."},
    {"slug": "mempawah", "name": "Peat fires, Mempawah", "region": "West Kalimantan, Indonesia", "kind": "Wildfire",
     "reason": "No distinct burn scars in the area screened, June–October."},
    {"slug": "farmington", "name": "Animas & San Juan floods", "region": "New Mexico, USA", "kind": "Flood",
     "reason": "No NISAR pass yet after the early-November floods."},
]


def _grid(lon, lat, half_km, max_px=MAX_PX):
    px = max(PIX_M, half_km * 2000 / max_px)
    n = int(round(half_km * 2000 / px))
    dlon = half_km / (111.32 * math.cos(math.radians(lat)))
    dlat = half_km / 110.57
    lons = lon - dlon + (np.arange(n) + 0.5) * 2 * dlon / n
    lats = lat + dlat - (np.arange(n) + 0.5) * 2 * dlat / n
    return np.meshgrid(lons, lats), [lon - dlon, lat - dlat, lon + dlon, lat + dlat], px


def render_pass(args):
    """One pass → (date, rgb, hh_db, valid fraction, note) or an error note."""
    slug, granule, lon, lat, half, max_px = args
    try:
        (LON, LAT), _, _ = _grid(lon, lat, half, max_px)
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
        if cx:
            rgb = gcov_rgb(hh, bands[cx])
        else:
            v = np.clip((np.nan_to_num(db, nan=-30) + 25) / 25, 0, 1) ** 0.8 * 255
            rgb = np.dstack([v, v, v])
        return slug, granule, (rgb, db, valid, co + ("+" + cx if cx else "")), f"{fobj.bytes_read / 1e6:.0f} MB"
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


def best_frame(granules):
    by = defaultdict(list)
    for g in granules:
        by["_".join(g["title"].split("_")[5:8])].append(g)
    frame = max(by, key=lambda k: len({g["start"][:10] for g in by[k]}))
    per_day = {}
    for g in sorted(by[frame], key=lambda g: (g.get("quality") == "validated", g["title"])):
        per_day[g["start"][:10]] = g  # one per day, validated preferred
    return frame, [per_day[d] for d in sorted(per_day)]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--only", action="append")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args(argv)

    previous = json.loads(OUT_PATH.read_text(encoding="utf-8")) if OUT_PATH.exists() else {}
    done = {s["slug"]: s for s in previous.get("sites", []) if s.get("passes")}
    jobs, plan = [], {}
    for slug, site in SITES.items():
        if args.only and slug not in args.only:
            continue
        d = 0.01
        granules = nisar.search_all_granules(
            "GCOV", bbox=[site["lon"] - d, site["lat"] - d, site["lon"] + d, site["lat"] + d])
        frame, passes = best_frame(granules)
        plan[slug] = frame
        print(f"{slug}: frame {frame}, {len(passes)} passes", flush=True)
        jobs += [(slug, g, site["lon"], site["lat"], site["half_km"], site.get("max_px", MAX_PX))
                 for g in passes]

    results = defaultdict(list)
    with ProcessPoolExecutor(args.workers) as pool:
        for slug, g, data, note in pool.map(render_pass, jobs):
            day = g["start"][:10]
            if data is None:
                print(f"  {slug} {day}: skipped ({note})", flush=True)
                continue
            rgb, db, valid, pols = data
            folder = IMAGE_DIR / slug
            folder.mkdir(parents=True, exist_ok=True)
            (folder / f"{day}.webp").write_bytes(encode_webp(rgb, valid))
            hh_png(db, valid).save(folder / f"{day}.hh.png", optimize=True)
            results[slug].append({
                "date": day, "quality": g.get("quality"), "polarizations": pols,
                "valid_pct": round(float(valid.mean()) * 100, 1),
                "image": f"landchange/{slug}/{day}.webp",
                "hh": f"landchange/{slug}/{day}.hh.png",
            })
            print(f"  {slug} {day}: {pols}, {note}", flush=True)

    for slug in plan:
        site = SITES[slug]
        passes = sorted(results[slug], key=lambda p: p["date"])
        wanted = {p["image"] for p in passes} | {p["hh"] for p in passes}
        for stale in (IMAGE_DIR / slug).glob("*"):
            if f"landchange/{slug}/{stale.name}" not in wanted:
                stale.unlink()
        _, bbox, px = _grid(site["lon"], site["lat"], site["half_km"], site.get("max_px", MAX_PX))
        dates = [p["date"] for p in passes]
        suggested = site.get("suggested") or ([dates[0], dates[-1]] if dates else None)
        done[slug] = {
            "slug": slug, **{k: v for k, v in site.items() if k not in ("suggested", "half_km", "max_px")},
            "bbox": [round(v, 5) for v in bbox], "pixel_m": round(px), "frame": plan[slug],
            "suggested": suggested, "passes": passes,
            "sources": [{"label": a, "url": b} for a, b in site.get("sources", [])],
        }

    for slug, entry in done.items():
        if slug in SITES and slug not in plan:
            site = SITES[slug]
            entry.update({k: v for k, v in site.items() if k not in ("suggested", "half_km", "max_px")})
            entry["sources"] = [{"label": a, "url": b} for a, b in site.get("sources", [])]
            if site.get("suggested"):
                entry["suggested"] = site["suggested"]
    sites = [done[s] for s in SITES if s in done]
    sites += [{**s, "status": "not_visible"} for s in NOT_VISIBLE]
    OUT_PATH.write_text(json.dumps({
        "_note": "Generated by scripts/build_landchange.py; regenerate rather than edit.",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "method": (
            "NISAR GCOV backscatter, frequency A (~20 m), every pass on one track/frame "
            "per site so images line up. Images: R = HH, G = HV, B = HH/HV (the crop "
            "sites' stretches). Change map: HH brightness difference in dB between two "
            f"dates (half resolution, 5 x 5 smoothed); dB stored as 8-bit {DB_LO:g}..{DB_HI:g}."
        ),
        "db_range": [DB_LO, DB_HI],
        "sites": sites,
    }, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
