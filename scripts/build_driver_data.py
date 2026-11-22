"""Fetch the related series (rain, river flow) shown beside each site's NISAR values.

Reads the drivers configured in ``app/chains.py`` and the dates of each
site's NISAR record (``app/data/nisar_observations.json``), fetches every
series from its public source and writes ``app/data/drivers.json``. No key
or login is needed.

Usage (repo root, venv active)::

    python scripts/build_driver_data.py                          # every site
    python scripts/build_driver_data.py --site sylhet-haor-floods

Sources: rain from ECMWF's IFS model (and ERA5 for seasonal normals) and
GloFAS river discharge through Open-Meteo (CC BY 4.0); the INGV earthquake
catalog is supported but no site uses it. See docs/DATA_AND_METHODS.md.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app import drivers  # noqa: E402
from app.chains import LEAD_DAYS, SITE_CHAINS  # noqa: E402

DATA_DIR = ROOT / "app" / "data"
NOTE = (
    "Daily driver series for the impact chains, fetched from public sources by "
    "scripts/build_driver_data.py. Regenerate with that script; do not edit by hand."
)


def latest_season_year(season, last: date) -> int:
    """Year of the most recent season that had finished by ``last``."""
    ends = date.fromisoformat(f"{last.year}-{season['end']}")
    return last.year if ends <= last else last.year - 1


def fetch(cfg, site, first: date, last: date) -> dict:
    start = first - timedelta(days=cfg.get("lead_days", LEAD_DAYS))
    if cfg["kind"] == "quakes":
        return drivers.fetch_quakes(site["bbox"], start, last)
    fetcher = drivers.fetch_rain if cfg["kind"] == "rain" else drivers.fetch_river
    series = fetcher(cfg["lat"], cfg["lon"], start, last)
    if cfg.get("season"):
        year = latest_season_year(cfg["season"], last)
        series["season"] = drivers.seasonal_normal(cfg["lat"], cfg["lon"], cfg["season"], year)
    return series


def write(path: Path, sites: dict):
    """One driver per line: readable diffs without thousands of value lines."""
    def compact(value):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

    blocks = []
    for slug in sorted(sites):
        rows = ",\n".join(
            f"   {json.dumps(driver_id)}: {compact(series)}"
            for driver_id, series in sites[slug].items()
        )
        blocks.append(f"  {json.dumps(slug)}: {{\n{rows}\n  }}")
    generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    path.write_text(
        "{\n"
        f' "_note": {json.dumps(NOTE)},\n'
        f' "generated_at": {json.dumps(generated)},\n'
        ' "sites": {\n' + ",\n".join(blocks) + "\n }\n}\n",
        encoding="utf-8",
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--site", action="append", help="Only this slug (repeatable).")
    args = parser.parse_args(argv)
    unknown = set(args.site or []) - set(SITE_CHAINS)
    if unknown:
        parser.error(f"no chain configured for: {sorted(unknown)}")

    sites = {s["slug"]: s for s in json.loads(
        (DATA_DIR / "sites.json").read_text(encoding="utf-8"))["sites"]}
    records = json.loads(
        (DATA_DIR / "nisar_observations.json").read_text(encoding="utf-8"))["sites"]
    path = drivers.SNAPSHOT_PATH
    out = json.loads(path.read_text(encoding="utf-8"))["sites"] if path.exists() else {}
    out = {slug: series for slug, series in out.items() if slug in SITE_CHAINS}

    for slug in args.site or SITE_CHAINS:
        scenes = records.get(slug, {}).get("scenes", [])
        if not scenes:
            print(f"{slug}: no NISAR passes yet; skipping", flush=True)
            continue
        first = date.fromisoformat(scenes[0]["date"])
        last = date.fromisoformat(scenes[-1]["date"])
        out[slug] = {}
        for cfg in SITE_CHAINS[slug]["drivers"]:
            series = fetch(cfg, sites[slug], first, last)
            out[slug][cfg["id"]] = series
            print(
                f"{slug} {cfg['id']}: {len(series['values'])} days from {series['start']}"
                + (f", season {series['season']}" if series.get("season") else ""),
                flush=True,
            )
        write(path, out)


if __name__ == "__main__":
    main()
