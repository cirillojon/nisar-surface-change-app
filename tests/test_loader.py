import json
from datetime import date

import pytest

from app import db, loader
from app.models import Observation, Scene, Site

SITE = {
    "slug": "basin",
    "name": "Basin",
    "change_type": "subsidence",
    "latitude": 19.4,
    "longitude": -99.0,
    "bbox": [-99.2, 19.2, -98.8, 19.6],
    "description": "Test",
}


def _files(tmp_path, sites, nisar):
    sites_path = tmp_path / "sites.json"
    sites_path.write_text(json.dumps({"sites": sites}), encoding="utf-8")
    nisar_path = tmp_path / "nisar_observations.json"
    nisar_path.write_text(json.dumps({"sites": nisar}), encoding="utf-8")
    scenes = tmp_path / "scenes"
    (scenes / "basin").mkdir(parents=True, exist_ok=True)
    (scenes / "basin" / "2026-06-01.webp").write_bytes(b"x")
    return {"sites_path": sites_path, "nisar_path": nisar_path, "scenes_dir": scenes}


def _scene(day="2026-06-01", **values):
    return {
        "date": day,
        "granule_id": "NISAR_L2_PR_GUNW_X",
        "quality": "provisional",
        "values": values or {"los_mm": -3.5},
        "image": f"basin/{day}.webp",
    }


def test_committed_data_files_are_valid():
    """Guards the committed data files and images, so CI catches a bad edit."""
    sites = loader.read_sites()
    data = loader.read_nisar_observations(loader.NISAR_DATA_PATH, [s["slug"] for s in sites])
    for s in sites:
        assert data.get(s["slug"], {}).get("scenes"), f"{s['slug']} has no NISAR data"


def test_seed_mirrors_files_and_is_idempotent(app, tmp_path):
    files = _files(tmp_path, [SITE], {"basin": {
        "product": "GUNW", "frame": "019_A_011", "reference": [-99.15, 19.3],
        "image_range_mm": 40, "scenes": [_scene()],
    }})
    first = loader.seed_sites(**files)
    assert first == {"sites": 1, "scenes": 1, "observations": 1}
    loader.seed_sites(**files)
    assert (Site.query.count(), Scene.query.count(), Observation.query.count()) == (1, 1, 1)

    site = Site.query.one()
    assert (site.product, site.frame, site.image_range) == ("GUNW", "019_A_011", 40)
    obs = site.observations[0]
    assert (obs.metric, obs.value, obs.unit, obs.source) == ("los_mm", -3.5, "mm", "nisar")
    assert site.scenes[0].image == "basin/2026-06-01.webp"


def test_sites_removed_from_file_are_deleted(app, tmp_path):
    loader.seed_sites(**_files(tmp_path, [SITE], {}))
    loader.seed_sites(**_files(tmp_path, [], {}))
    assert Site.query.count() == 0


def test_seed_keeps_rows_from_other_sources(app, tmp_path):
    files = _files(tmp_path, [SITE], {"basin": {"scenes": [_scene()]}})
    loader.seed_sites(**files)
    db.session.add(Observation(
        site_id=Site.query.one().id, observed_on=date(2026, 1, 1), metric="los_mm",
        value=1.0, unit="mm", source="gnss",
    ))
    db.session.commit()
    loader.seed_sites(**files)
    assert Observation.query.filter_by(source="gnss").count() == 1


@pytest.mark.parametrize("nisar, message", [
    ({"atlantis": {"scenes": []}}, "unknown site slug"),
    ({"basin": {"scenes": [{"date": "06/01/2026", "values": {"los_mm": 1}}]}}, "bad scene"),
    ({"basin": {"scenes": [{"date": "2026-06-01"}]}}, "bad scene"),
    ({"basin": {"scenes": [_scene(depth_m=1)]}}, "unknown metric"),
    ({"basin": {"scenes": [_scene(day="2026-06-13")]}}, "image missing"),
])
def test_bad_data_is_rejected(app, tmp_path, nisar, message):
    with pytest.raises(ValueError, match=message):
        loader.seed_sites(**_files(tmp_path, [SITE], nisar))
    assert Site.query.count() == 0


def test_point_outside_bbox_is_rejected(app, tmp_path):
    with pytest.raises(ValueError, match="outside its bbox"):
        loader.seed_sites(**_files(tmp_path, [{**SITE, "latitude": 25.0}], {}))


def test_cli_load_fails_loudly(app, monkeypatch):
    def _boom():
        raise ValueError("nisar_observations.json: bad scene")

    monkeypatch.setattr(loader, "seed_sites", _boom)
    result = app.test_cli_runner().invoke(args=["nisar", "load", "--force"])
    assert result.exit_code == 1
    assert "bad scene" in result.output
