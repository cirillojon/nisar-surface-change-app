"""Open water compared over the footprint every pass imaged (scripts/shared_footprint.py)."""
import json
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import shared_footprint as sf  # noqa: E402

from app import loader  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "app" / "data"


def _entry(tmp_path, masks):
    """A site entry whose passes have exact class masks on disk."""
    scenes = []
    for i, mask in enumerate(masks):
        rel = f"site/2026-01-{i + 1:02d}.mask.png"
        sf.write_mask(tmp_path / rel, mask)
        valid = mask != sf.UNOBSERVED
        scenes.append({
            "date": f"2026-01-{i + 1:02d}",
            "valid_pct": round(valid.mean() * 100, 1),
            "values": {"water_visible_pct": round((mask == sf.WATER).sum() / valid.sum() * 100, 1)},
            "mask": rel,
        })
    return {"product": "GCOV", "scenes": scenes}


def test_passes_are_compared_over_the_pixels_every_pass_imaged(tmp_path):
    # Pass A sees the whole 10x10 box; its right-hand 3 columns are dry, the
    # rest is half water. Pass B sees only the left 7 columns, same water.
    left = np.zeros((10, 10), bool)
    left[:, :7] = True
    water = np.zeros((10, 10), bool)
    water[:5, :7] = True
    a = sf.classes(np.ones((10, 10), bool), water)
    b = sf.classes(left, water)
    entry = _entry(tmp_path, [a, b])
    assert [s["values"]["water_visible_pct"] for s in entry["scenes"]] == [35.0, 50.0]

    fp = sf.apply_site(entry, "site", tmp_path)

    # Over the same ground, the two passes agree: the apparent change was coverage.
    assert [s["values"]["water_pct"] for s in entry["scenes"]] == [50.0, 50.0]
    assert [s["values"]["water_visible_pct"] for s in entry["scenes"]] == [35.0, 50.0]
    assert fp | {"image": None} == {"passes": 2, "pct_of_box": 70.0, "min_pct": 50, "method": "exact",
                                    "status": "ok", "image": None}
    overlay = np.asarray(Image.open(tmp_path / fp["image"]))
    assert (overlay[:, :7, 3] == 0).all() and (overlay[:, 7:, 3] > 0).all()   # hatch only where unshared


def test_unobserved_pixels_are_never_counted_as_dry():
    valid = np.array([[True, False], [True, True]])
    water = np.array([[True, True], [False, False]])     # the unobserved pixel is not water either
    mask = sf.classes(valid, water)
    assert mask.tolist() == [[sf.WATER, sf.UNOBSERVED], [sf.DRY, sf.DRY]]


def test_too_little_shared_coverage_gives_no_comparable_value(tmp_path):
    left, right = np.zeros((10, 10), bool), np.zeros((10, 10), bool)
    left[:, :6], right[:, 5:] = True, True                 # they share one column
    water = np.zeros((10, 10), bool)
    entry = _entry(tmp_path, [sf.classes(left, water), sf.classes(right, water)])

    fp = sf.apply_site(entry, "site", tmp_path)

    assert fp["status"] == "insufficient" and fp["pct_of_box"] == 10.0
    assert all("water_pct" not in s["values"] for s in entry["scenes"])          # nothing stands in
    assert all("water_visible_pct" in s["values"] for s in entry["scenes"])
    assert not (tmp_path / "site" / sf.FOOTPRINT_NAME).exists()


def test_passes_on_different_grids_are_refused():
    with pytest.raises(ValueError, match="different grids"):
        sf.shared_of([np.ones((4, 4), bool), np.ones((4, 5), bool)])


def test_calibrated_share_is_exact_where_a_pass_imaged_only_the_shared_area():
    rng = np.random.default_rng(1)
    red = rng.integers(0, 255, (50, 50)).astype(np.uint8)
    valid = np.ones((50, 50), bool)
    assert sf.calibrated_share(red, valid, valid, 23.4) == pytest.approx(23.4)


def test_the_loader_refuses_open_water_without_enough_shared_coverage(tmp_path):
    data = {"sites": {"x": {"product": "GCOV", "footprint": {"status": "insufficient"},
                            "scenes": [{"date": "2026-01-01", "values": {"water_pct": 3.0}}]}}}
    path = tmp_path / "obs.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(ValueError, match="without enough shared coverage"):
        loader.read_nisar_observations(path, ["x"], tmp_path)


def test_committed_open_water_matches_the_shared_footprint_pipeline():
    """The committed values are what scripts/shared_footprint.py computes from
    the committed images, and every water site states how they were computed."""
    committed = json.loads((DATA / "nisar_observations.json").read_text(encoding="utf-8"))["sites"]
    entry = json.loads(json.dumps(committed["sylhet-haor-floods"]))
    fp = sf.apply_from_images(entry, "sylhet-haor-floods", DATA / "scenes")
    assert fp == committed["sylhet-haor-floods"]["footprint"]
    assert [s["values"] for s in entry["scenes"]] == [s["values"] for s in committed["sylhet-haor-floods"]["scenes"]]
    for slug, site in committed.items():
        if site["product"] != "GCOV":
            continue
        assert site["footprint"]["status"] == "ok", slug
        for scene in site["scenes"]:
            assert {"water_pct", "water_visible_pct"} <= set(scene["values"]), (slug, scene["date"])
            if scene["valid_pct"] == site["footprint"]["pct_of_box"] or site["footprint"]["pct_of_box"] == 100:
                # A pass that imaged only the shared area keeps its exact value.
                assert scene["values"]["water_pct"] == scene["values"]["water_visible_pct"], (slug, scene["date"])


def test_image_method_error_is_within_the_stated_uncertainty():
    stats = sf.validate(slugs=["jamuna", "rio-branco"])
    assert stats["cases"] > 20
    assert stats["p99_abs_error_pp"] <= sf.IMAGE_UNCERTAINTY_PP
