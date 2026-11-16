"""Print every number behind the site stories as Markdown tables.

Reads only committed files (``app/data/``), so anyone can check the numbers
quoted in ``docs/DATA_AND_METHODS.md`` and shown in the app. No key or
login is needed.

Usage (repo root, venv active)::

    python scripts/chain_evidence.py           # print the tables
    python scripts/chain_evidence.py --write   # refresh them in the document
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app import chains, drivers, models  # noqa: E402
from app.chains import SITE_CHAINS  # noqa: E402

DATA_DIR = ROOT / "app" / "data"
DOC_PATH = ROOT / "docs" / "DATA_AND_METHODS.md"
# The moment written out pass by pass, so a reader can refit the pace by hand.
EXAMPLE = ("mexico-city-subsidence", "drier-months")
# The site whose open water is listed pass by pass (its passes image different areas).
FOOTPRINT_EXAMPLE = "sylhet-haor-floods"
# Passes covering less of the box than this are drawn hollow in the app.
FULL_COVERAGE = 95


def load(name: str) -> dict:
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


def table(header: list[str], rows: list[list]) -> str:
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    lines += ["| " + " | ".join(str(cell) for cell in row) + " |" for row in rows]
    return "\n".join(lines)


def coord(lat: float, lon: float) -> str:
    return f"{abs(lat):.3f}°{'N' if lat >= 0 else 'S'}, {abs(lon):.3f}°{'E' if lon >= 0 else 'W'}"


def signed(value: float, digits: int = 2, plus: bool = False) -> str:
    """A number with a real minus sign, and no "−0.00"."""
    value = round(value, digits) + 0.0
    return f"{value:{'+' if plus else ''}.{digits}f}".replace("-", "−")


def site_dict(slug: str, record: dict) -> dict:
    """The part of ``Site.to_dict(detail=True)`` a story needs, from the data file."""
    return {"slug": slug, "product": record["product"], "footprint": record.get("footprint"), "scenes": [
        {"date": s["date"], "valid_pct": s.get("valid_pct"), "quality": s.get("quality"),
         "mode": models.acquisition_mode(s.get("granule_id"))}
        for s in record["scenes"]
    ], "observations": [
        {"metric": metric, "observed_on": scene["date"], "value": value}
        for scene in record["scenes"] for metric, value in scene["values"].items()
    ]}


def last_day(series: dict) -> date:
    return date.fromisoformat(series["start"]) + timedelta(days=len(series["values"]) - 1)


def nisar_table(names, records, site_chains) -> str:
    rows = []
    for slug, chain in site_chains.items():
        record, scenes = records[slug], records[slug]["scenes"]
        quality = Counter(s["quality"] for s in scenes if s.get("quality"))
        partial = [s for s in scenes if (s.get("valid_pct") or 100) < FULL_COVERAGE]
        rows.append([
            names[slug], record["product"], f"`{record['frame']}`", len(scenes),
            f"{scenes[0]['date']} to {scenes[-1]['date']}",
            ", ".join(f"{n} {q}" for q, n in sorted(quality.items())),
            f"{len(partial)} (lowest {min(s['valid_pct'] for s in partial):.0f}%)" if partial else "0",
            f"{chain['radar']['label']} ({chain['radar']['unit']}): {chain['radar']['summary']}",
        ])
    return table(
        ["Site", "Product", "Track/frame", "Passes", "First to last", "Granule quality",
         f"Passes under {FULL_COVERAGE}% of the box", "Charted"],
        rows,
    )


def moment_table(names, site_chains) -> str:
    rows = []
    for slug, chain in site_chains.items():
        unit = chain["radar"]["unit"]
        for moment in chain["moments"]:
            related = moment["related"]
            rows.append([
                names[slug],
                moment["title"] + (f" ({moment['season']})" if moment["season"] else ""),
                f"{moment['start']} to {moment['end']}" if moment["start"] != moment["end"]
                else moment["end"],
                moment["passes"],
                f"{moment['stat']}{'' if moment['unit'] == unit else ' of the open-water measure'}",
                f"**{moment['display']}**", moment["detail"],
                f"{related['label']} {related['display']} ({related['span']})" if related else "",
            ])
    return table(
        ["Site", "Moment", "Passes in range", "n", "Statistic", "Shown", "Detail", "Related, same dates"],
        rows,
    )


def trend_table(names, site_chains) -> str:
    """How straight, and how noisy, each displacement record is."""
    rows = []
    for slug, chain in site_chains.items():
        if chain["radar"]["metric"] not in chains.CUMULATIVE_METRICS:
            continue
        points = chain["radar"]["points"]
        first = date.fromisoformat(points[0]["date"])
        days = [(date.fromisoformat(p["date"]) - first).days for p in points]
        values = [p["value"] for p in points]
        steps = [b - a for a, b in zip(values, values[1:])]
        slope = statistics.linear_regression(days, values).slope
        rows.append([
            names[slug], f"{signed(values[-1], 1, plus=True)} mm over {days[-1]} days",
            f"{signed(slope * 365.25, 0, plus=True)} mm/year",
            f"{statistics.correlation(days, values) ** 2:.2f}",
            f"{signed(statistics.mean(steps), 1, plus=True)} mm",
            f"{statistics.stdev(steps):.1f} mm",
        ])
    return table(
        ["Site", "Displacement", "Straight-line fit", "R² of the fit",
         "Mean change between passes", "Standard deviation of those changes"],
        rows,
    )


def driver_table(names, sites, snapshot) -> str:
    rows = []
    for slug, cfg in SITE_CHAINS.items():
        for driver in cfg["drivers"]:
            series = snapshot[slug][driver["id"]]
            if driver["kind"] == "quakes":
                west, south, east, north = sites[slug]["bbox"]
                asked, used = f"box {coord(south, west)} to {coord(north, east)}", "whole box"
            else:
                asked = coord(driver["lat"], driver["lon"])
                used = coord(series["latitude"], series["longitude"])
            rows.append([
                names[slug], f"{driver['label']} ({driver['place']})",
                drivers.KINDS[driver["kind"]]["source"]["name"], asked, used,
                f"{len(series['values'])} days, {series['start']} to {last_day(series)}",
            ])
    return table(
        ["Site", "Related series", "Source", "Point asked for", "Grid cell returned",
         "Daily values"],
        rows,
    )


def season_table(names, snapshot) -> str:
    rows = []
    for slug, cfg in SITE_CHAINS.items():
        for driver in cfg["drivers"]:
            season = snapshot[slug][driver["id"]].get("season")
            if not season:
                continue
            rows.append([
                names[slug], f"{season['label']} {season['end'][:4]}",
                f"{season['total']} mm", f"{season['normal']} mm ({season['baseline']} mean)",
                f"{season['pct_of_normal']}%",
                f"{season['rank']} of {season['years']} (1 = driest)",
                f"{season['source']}, cell {coord(season['latitude'], season['longitude'])}",
            ])
    return table(
        ["Site", "Season", "Rain", "Normal", "Share of normal", "Rank", "Source"], rows,
    )


def footprint_table(names, records) -> str:
    rows = []
    for slug, record in records.items():
        fp = record.get("footprint")
        if not fp:
            continue
        rows.append([
            names[slug], f"{fp['pct_of_box']}%", fp["passes"], fp["status"],
            "HDF5 masks" if fp["method"] == "exact" else
            f"scene images, calibrated (±{fp['uncertainty_pp']} pts on {len(fp.get('estimated', []))} passes)",
        ])
    return table(["Site", "Shared footprint (of the box)", "Passes", "Status", "Computed from"], rows)


def footprint_detail(names, records) -> str:
    slug = FOOTPRINT_EXAMPLE
    rows = []
    for s in records[slug]["scenes"]:
        v = s["values"]
        rows.append([
            s["date"], f"`{models.acquisition_mode(s['granule_id'])}`", f"{s['valid_pct']:.1f}%",
            f"{v['water_visible_pct']:.1f}%", f"**{v['water_pct']:.1f}%**" if "water_pct" in v else "–",
        ])
    return "\n".join([
        f"Per pass: {names[slug]}.",
        "",
        table(["Pass", "Acquisition mode", "Box imaged", "Open water, pixels this pass imaged",
               "Open water, shared footprint (charted)"], rows),
    ])


def example_table(names, site_chains) -> str:
    slug, moment_id = EXAMPLE
    chain = site_chains[slug]
    moment = next(m for m in chain["moments"] if m["id"] == moment_id)
    points = [p for p in chain["radar"]["points"] if moment["start"] <= p["date"] <= moment["end"]]
    first = date.fromisoformat(points[0]["date"])
    rows = [[p["date"], (date.fromisoformat(p["date"]) - first).days, signed(p["value"], 1)]
            for p in points]
    slope = statistics.linear_regression([r[1] for r in rows], [p["value"] for p in points]).slope
    return "\n".join([
        f"Worked example: {names[slug]}, “{moment['title']}”.",
        "",
        table(["Pass date", "Days since first", f"{chain['radar']['label']} ({chain['radar']['unit']})"], rows),
        "",
        f"Least-squares slope = {signed(slope, 4)} mm/day × {chains.DAYS_PER_MONTH} days = "
        f"{signed(slope * chains.DAYS_PER_MONTH, 1)} mm/month, shown as “{moment['display']}” "
        f"with standard error {moment['detail']}.",
    ])


def evidence(names, sites, records, snapshot, stamps) -> str:
    site_chains = {
        slug: chains.get_site_chain(site_dict(slug, records[slug]), snapshot=snapshot)
        for slug in SITE_CHAINS
    }
    return "\n\n".join([
        f"_Generated by `scripts/chain_evidence.py` from NISAR values dated "
        f"{stamps['nisar']} and related data dated {stamps['drivers']}._",
        "**NISAR record per site**",
        nisar_table(names, records, site_chains),
        "**Moments: every number shown in the tiles**",
        moment_table(names, site_chains),
        example_table(names, site_chains),
        "**Displacement record: fit and noise**",
        trend_table(names, site_chains),
        "**Related series: what was asked for and what came back**",
        driver_table(names, sites, snapshot),
        "**Seasonal normals**",
        season_table(names, snapshot),
        "**Open water: the shared footprint**",
        footprint_table(names, records),
        footprint_detail(names, records),
    ])


def write_block(text: str, name: str, block: str) -> str:
    start, end = f"<!-- {name}:start -->", f"<!-- {name}:end -->"
    if start not in text or end not in text:
        raise SystemExit(f"{DOC_PATH.name}: markers for '{name}' not found")
    head, rest = text.split(start, 1)
    return f"{head}{start}\n{block}\n{end}{rest.split(end, 1)[1]}"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--write", action="store_true", help=f"Refresh {DOC_PATH.name}.")
    args = parser.parse_args(argv)

    sites = {s["slug"]: s for s in load("sites.json")["sites"]}
    names = {slug: site["name"] for slug, site in sites.items()}
    observations, snapshot = load("nisar_observations.json"), load("drivers.json")
    stamps = {
        "nisar": observations["generated_at"][:10], "drivers": snapshot["generated_at"][:10],
    }
    blocks = {
        "evidence": evidence(names, sites, observations["sites"], snapshot["sites"], stamps),
    }

    if not args.write:
        print("\n\n".join(blocks.values()))
        return
    raw = DOC_PATH.read_bytes().decode("utf-8")
    eol = "\r\n" if "\r\n" in raw else "\n"
    text = raw.replace("\r\n", "\n")
    for name, block in blocks.items():
        text = write_block(text, name, block)
    DOC_PATH.write_bytes(text.replace("\n", eol).encode("utf-8"))
    print(f"Updated {', '.join(blocks)} in {DOC_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
