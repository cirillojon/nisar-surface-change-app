"""Loader: mirrors the curated site data files into the database.

  • ``app/data/sites.json``              — site definitions (hand-edited).
  • ``app/data/nisar_observations.json`` — per-date values and images
                                           computed from NISAR granules by
                                           ``scripts/extract_nisar.py``.
  • ``app/data/scenes/``                 — the images, served by the API.

Every run rewrites the sites, scenes and ``source='nisar'`` observations so
the DB matches the files; sites removed from ``sites.json`` are deleted.
Observation rows with any other ``source`` are left alone.

Contract (used by ``app/cli.py`` and ``bin/start``):

  • ``load(force=False, ttl_hours=None)`` is the single public entry.
  • Returns a JSON-serializable dict so the CLI can echo it.
  • Updates a ``LoadJob`` row keyed by ``source_id`` so ``/api/health``
    and ``flask nisar status`` can surface freshness.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from app import db
from app.change_types import CHANGE_TYPES, METRICS
from app.models import LoadJob, Observation, Scene, Site

logger = logging.getLogger(__name__)

SOURCE_ID = "nisar_sites"
DATA_DIR = Path(__file__).parent / "data"
SITES_PATH = DATA_DIR / "sites.json"
NISAR_DATA_PATH = DATA_DIR / "nisar_observations.json"
SCENES_DIR = DATA_DIR / "scenes"

DEFAULT_TTL_HOURS = 24.0


def _record_attempt(success: bool, item_count: int = 0, error: Optional[str] = None):
    job = db.session.get(LoadJob, SOURCE_ID)
    now = datetime.utcnow()
    if job is None:
        job = LoadJob(source_id=SOURCE_ID)
        db.session.add(job)
    job.last_attempt_at = now
    if success:
        job.last_success_at = now
        job.item_count = item_count
        job.last_error = None
    else:
        job.last_error = (error or "")[:2000] or None
    db.session.commit()


def _within_ttl(job: Optional[LoadJob], ttl_hours: float) -> bool:
    if job is None or job.last_success_at is None:
        return False
    return datetime.utcnow() - job.last_success_at < timedelta(hours=ttl_hours)


def read_sites(path: Path = SITES_PATH) -> list[dict]:
    sites = json.loads(path.read_text(encoding="utf-8"))["sites"]
    slugs = [s["slug"] for s in sites]
    if len(slugs) != len(set(slugs)):
        raise ValueError(f"{path.name}: duplicate slugs")
    for s in sites:
        if s.get("change_type") not in CHANGE_TYPES:
            raise ValueError(f"{path.name}: '{s['slug']}' has unknown change_type")
        min_lon, min_lat, max_lon, max_lat = s["bbox"]
        if not (min_lon < s["longitude"] < max_lon and min_lat < s["latitude"] < max_lat):
            raise ValueError(f"{path.name}: '{s['slug']}' point is outside its bbox")
    return sites


def read_nisar_observations(
    path: Path, known_slugs, scenes_dir: Path = SCENES_DIR,
) -> dict[str, dict]:
    """Parse and validate the generated data file → ``{slug: site_entry}``."""
    if not path.exists():
        return {}
    sites = json.loads(path.read_text(encoding="utf-8")).get("sites", {})
    unknown = sorted(set(sites) - set(known_slugs))
    if unknown:
        raise ValueError(
            f"{path.name}: unknown site slug(s) {unknown}; add them to sites.json "
            "or rerun scripts/extract_nisar.py"
        )
    for slug, entry in sites.items():
        for scene in entry.get("scenes", []):
            try:
                date.fromisoformat(scene["date"])
                values = {k: float(v) for k, v in scene["values"].items()}
            except (KeyError, TypeError, ValueError, AttributeError):
                raise ValueError(f"{path.name}: bad scene for '{slug}': {scene!r}") from None
            bad = sorted(set(values) - set(METRICS))
            if bad:
                raise ValueError(f"{path.name}: '{slug}' has unknown metric(s) {bad}")
            image = scene.get("image")
            if image and not (scenes_dir / image).is_file():
                raise ValueError(f"{path.name}: '{slug}' image missing: scenes/{image}")
        footprint = entry.get("footprint")
        if footprint is not None:
            if footprint.get("status") not in ("ok", "insufficient"):
                raise ValueError(f"{path.name}: '{slug}' footprint has no valid status")
            image = footprint.get("image")
            if image and not (scenes_dir / image).is_file():
                raise ValueError(f"{path.name}: '{slug}' footprint image missing: scenes/{image}")
            if footprint["status"] == "insufficient" and any(
                "water_pct" in s["values"] for s in entry.get("scenes", [])
            ):
                raise ValueError(
                    f"{path.name}: '{slug}' has water_pct without enough shared coverage"
                )
    return sites


def seed_sites(
    sites_path: Path = SITES_PATH,
    nisar_path: Path = NISAR_DATA_PATH,
    scenes_dir: Path = SCENES_DIR,
) -> dict[str, int]:
    """Make the DB mirror the data files. Returns counts written."""
    specs = read_sites(sites_path)
    data = read_nisar_observations(nisar_path, [s["slug"] for s in specs], scenes_dir)
    written = {"sites": 0, "scenes": 0, "observations": 0}

    for stale in Site.query.filter(Site.slug.notin_([s["slug"] for s in specs])).all():
        db.session.delete(stale)

    for spec in specs:
        entry = data.get(spec["slug"], {})
        site = Site.query.filter_by(slug=spec["slug"]).first()
        if site is None:
            site = Site(slug=spec["slug"])
            db.session.add(site)
        site.name = spec["name"]
        site.change_type = spec["change_type"]
        site.description = spec.get("description")
        site.latitude = spec["latitude"]
        site.longitude = spec["longitude"]
        site.min_lon, site.min_lat, site.max_lon, site.max_lat = spec["bbox"]
        site.event_date = (
            date.fromisoformat(spec["event_date"]) if spec.get("event_date") else None
        )
        site.product = entry.get("product") or CHANGE_TYPES[spec["change_type"]]["product"]
        site.frame = entry.get("frame")
        site.reference_lon, site.reference_lat = entry.get("reference") or (None, None)
        site.image_range = entry.get("image_range_mm")
        site.footprint = entry.get("footprint")
        db.session.flush()
        written["sites"] += 1

        Scene.query.filter_by(site_id=site.id).delete(synchronize_session=False)
        Observation.query.filter_by(site_id=site.id, source="nisar").delete(
            synchronize_session=False,
        )
        for scene in entry.get("scenes", []):
            day = date.fromisoformat(scene["date"])
            db.session.add(Scene(
                site_id=site.id,
                acquired_on=day,
                granule_id=scene.get("granule_id"),
                quality=scene.get("quality"),
                valid_pct=scene.get("valid_pct"),
                image=scene.get("image"),
            ))
            written["scenes"] += 1
            for metric, value in scene["values"].items():
                db.session.add(Observation(
                    site_id=site.id,
                    observed_on=day,
                    metric=metric,
                    value=float(value),
                    unit=METRICS[metric]["unit"],
                    source="nisar",
                    granule_id=scene.get("granule_id"),
                ))
                written["observations"] += 1
    db.session.commit()
    # Bulk deletes bypass the relationship cache; reload on next access.
    db.session.expire_all()
    return written


def load(force: bool = False, ttl_hours: Optional[float] = None) -> dict:
    """Seed/refresh site data, skipping if the last success is within the TTL."""
    ttl = float(ttl_hours) if ttl_hours is not None else DEFAULT_TTL_HOURS
    job = db.session.get(LoadJob, SOURCE_ID)
    if not force and _within_ttl(job, ttl):
        logger.info(
            "[loader] %s: within TTL (%.1fh) — skipping", SOURCE_ID, ttl,
        )
        return {SOURCE_ID: {"skipped": True, "reason": "within_ttl"}}

    try:
        written = seed_sites()
        _record_attempt(success=True, item_count=written["observations"])
        logger.info("[loader] %s: ok %s", SOURCE_ID, written)
        return {SOURCE_ID: {"ok": True, **written}}
    except Exception as exc:  # noqa: BLE001 — top-level catch is intentional
        db.session.rollback()
        logger.exception("[loader] %s: failed", SOURCE_ID)
        _record_attempt(success=False, error=str(exc))
        return {SOURCE_ID: {"ok": False, "error": str(exc)}}


def status() -> list[dict]:
    """Return all LoadJob rows as a list of dicts (CLI helper)."""
    return [row.to_dict() for row in LoadJob.query.order_by(LoadJob.source_id).all()]
