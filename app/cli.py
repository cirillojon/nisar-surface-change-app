"""Flask CLI commands.

Registered in ``app/__init__.py`` via ``register_cli(app)``.

Usage:
    flask nisar load                # seed/refresh site data (TTL gated)
    flask nisar load --force        # reload now (use after editing app/data/*.json)
    flask nisar load --ttl-hours 12
    flask nisar status              # print last-run state per source
    flask nisar check-schema        # exit 1 if models drift from migrations
    flask nisar search --bbox -99.3,19.2,-98.9,19.6 --product GCOV
    flask nisar sme2-prewarm --region washington   # render SME2 ahead of time
    flask nisar sme2-import-local --file pass.h5 --bbox -120,46,-119,47
    flask nisar sme2-prewarm --bbox -120,46,-119,47 --dry-run
"""
from __future__ import annotations

import json
import logging
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import click
from flask.cli import AppGroup

from app import db, loader, nisar
from app.validators import validate_bbox

logger = logging.getLogger(__name__)


nisar_cli = AppGroup(
    "nisar",
    help="Data loading, NISAR search, status, and schema-check commands.",
)


@nisar_cli.command("load")
@click.option(
    "--force/--no-force", default=False,
    help="Ignore the TTL and run the loader unconditionally.",
)
@click.option(
    "--ttl-hours", type=float, default=None,
    help="Override LOADER_TTL_HOURS for this run.",
)
def nisar_load(force, ttl_hours):
    """Load app/data/sites.json + nisar_observations.json into the DB."""
    result = loader.load(force=force, ttl_hours=ttl_hours)
    click.echo(json.dumps(result, indent=2, default=str))
    outcomes = list(result.values())
    if any(o.get("skipped") for o in outcomes):
        click.echo("Skipped: loaded recently. Use --force to reload now.", err=True)
    if any(o.get("ok") is False for o in outcomes):
        sys.exit(1)


@nisar_cli.command("status")
def nisar_status():
    """Print all LoadJob rows as JSON."""
    click.echo(json.dumps(loader.status(), indent=2, default=str))


@nisar_cli.command("search")
@click.option("--bbox", required=True, help="min_lon,min_lat,max_lon,max_lat")
@click.option(
    "--product", type=click.Choice(sorted(nisar.PRODUCTS)), default="GCOV",
    show_default=True,
)
@click.option("--days", type=int, default=90, show_default=True, help="Look-back window.")
@click.option("--limit", type=int, default=10, show_default=True)
def nisar_search(bbox, product, days, limit):
    """Search NASA CMR for NISAR granules over a bounding box."""
    try:
        box = validate_bbox(bbox)
    except ValueError as exc:
        raise click.BadParameter(str(exc), param_hint="--bbox")
    end = date.today()
    result = nisar.search_granules(
        box, end - timedelta(days=days), end, product=product, limit=limit,
    )
    click.echo(f"{result['hits']} {product} granules found; showing {len(result['granules'])}")
    for g in result["granules"]:
        click.echo(f"  {g['start'][:10]}  {g['quality']:<11}  {g['title']}")
        if g["data_url"]:
            click.echo(f"      {g['data_url']}")


REGIONS_PATH = Path(__file__).resolve().parent / "data" / "regions.json"


def _load_regions() -> dict:
    return json.loads(REGIONS_PATH.read_text(encoding="utf-8"))["regions"]


@nisar_cli.command("sme2-prewarm")
@click.option("--region", help="Named region from app/data/regions.json, e.g. washington.")
@click.option("--bbox", help="min_lon,min_lat,max_lon,max_lat (instead of --region).")
@click.option("--start", type=click.DateTime(["%Y-%m-%d"]), help="First date (default: all).")
@click.option("--end", type=click.DateTime(["%Y-%m-%d"]), help="Last date (default: today).")
@click.option("--workers", type=int, default=4, show_default=True,
              help="Granules rendered in parallel (separate processes).")
@click.option("--dry-run", is_flag=True, help="Only count granules and estimate the cost.")
def nisar_sme2_prewarm(region, bbox, start, end, workers, dry_run):
    """Render every SME2 granule over a region ahead of time.

    Rendered frames are cached in <DATA_DIR>/sme2/, so the map shows them
    instantly. Re-run any time: cached granules are skipped, so this also
    picks up new passes (NASA publishes SME2 a few weeks after acquisition).
    Needs EARTHDATA_TOKEN (or ~/.netrc).
    """
    from concurrent.futures import ProcessPoolExecutor, as_completed

    from app import sme2

    regions = _load_regions()
    if bool(region) == bool(bbox):
        raise click.UsageError(
            f"give --region ({', '.join(sorted(regions))}) or --bbox"
        )
    where = {}
    if region:
        if region not in regions:
            raise click.BadParameter(
                f"unknown region; choose from {', '.join(sorted(regions))}",
                param_hint="--region",
            )
        where["polygon"] = regions[region]["polygon"]
        label = regions[region]["name"]
    else:
        try:
            where["bbox"] = validate_bbox(bbox)
        except ValueError as exc:
            raise click.BadParameter(str(exc), param_hint="--bbox")
        label = f"bbox {bbox}"

    granules = nisar.search_all_granules(
        sme2.PRODUCT, **where,
        start=start.date() if start else None, end=end.date() if end else None,
    )
    todo = [g for g in granules if g.get("data_url") and g.get("bbox")
            and not sme2.is_cached(g["title"])]
    frames = {"_".join(g["title"].split("_")[5:8]) for g in granules}
    click.echo(
        f"{label}: {len(granules)} SME2 granules on {len(frames)} frames, "
        f"{len(granules) - len(todo)} already cached, {len(todo)} to render."
    )
    if dry_run or not todo:
        if todo:
            # Measured: ~25 MB downloaded, ~11 s and ~0.8 MB stored per granule.
            click.echo(
                f"Estimate: ~{len(todo) * 25 / 1000:.1f} GB to download, "
                f"~{len(todo) * 11 / 60 / max(workers, 1):.0f} min with {workers} workers, "
                f"~{len(todo) * 0.8:.0f} MB stored."
            )
        return
    if not sme2.has_credentials():
        raise click.ClickException("No Earthdata Login: set EARTHDATA_TOKEN in .env")

    started = time.monotonic()
    counts = {"rendered": 0, "failed": 0, "cached": 0}
    failures = []
    # Processes, not threads: h5py serializes reads under a global lock.
    with ProcessPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = [pool.submit(sme2.prewarm_one, g) for g in todo]
        for i, fut in enumerate(as_completed(futures), 1):
            res = fut.result()
            counts[res["status"]] += 1
            if res["status"] == "failed":
                failures.append(res)
            detail = (
                f"{res.get('seconds')} s, {res.get('mb_read')} MB"
                if res["status"] == "rendered" else res.get("error", "")
            )
            click.echo(f"[{i}/{len(todo)}] {res['status']:<8} {res['title'][17:60]}  {detail}")
    minutes = (time.monotonic() - started) / 60
    click.echo(
        f"Done in {minutes:.1f} min: {counts['rendered']} rendered, "
        f"{counts['failed']} failed. Re-run to retry failures."
    )
    if failures:
        sys.exit(1)


@nisar_cli.command("sme2-import-local")
@click.option("--file", "file_path", required=True,
              type=click.Path(exists=True, dir_okay=False, resolve_path=True),
              help="Local NISAR SME2 HDF5 file.")
@click.option("--bbox", required=True, help="min_lon,min_lat,max_lon,max_lat")
def nisar_sme2_import_local(file_path, bbox):
    """Render a local SME2 HDF5 into DATA_DIR for offline scene queries.

    The imported frame is marked quality=unknown because CMR provenance is not
    available from a local file alone. The bbox is required because the local
    file's complete product footprint is not inferred by this command.
    """
    from app import sme2

    try:
        box = sme2.validate_area(validate_bbox(bbox))
        meta = sme2.import_local_file(file_path, box)
    except (OSError, ValueError, sme2.Sme2Error) as exc:
        raise click.ClickException(str(exc)) from exc
    click.echo(json.dumps({
        "granule_id": meta["granule_id"],
        "date": meta["date"],
        "source": meta["source"],
        "quality": meta["quality"],
        "images": meta["images"],
    }, indent=2))


@nisar_cli.command("check-schema")
def nisar_check_schema():
    """Exit 1 if SQLAlchemy models drift from the alembic head."""
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    with db.engine.connect() as conn:
        ctx = MigrationContext.configure(conn)
        diff = compare_metadata(ctx, db.metadata)

    if not diff:
        click.echo("[check-schema] OK — models match migration head.")
        return

    click.echo("[check-schema] DRIFT DETECTED:", err=True)
    for entry in diff:
        click.echo(f"  - {entry}", err=True)
    click.echo(
        "\nGenerate a migration with:\n"
        "  flask db migrate -m \"<describe change>\"\n"
        "then commit it.",
        err=True,
    )
    sys.exit(1)


def register_cli(app):
    app.cli.add_command(nisar_cli)
