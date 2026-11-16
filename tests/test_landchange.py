"""Land-change gallery: API endpoint and build-script helpers."""
import json
import sys
from pathlib import Path

import numpy as np

from app.routes import api

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))


def test_landchange_endpoint_adds_image_urls(client, tmp_path, monkeypatch):
    path = tmp_path / "landchange.json"
    path.write_text(json.dumps({
        "_note": "generated",
        "db_range": [-30, 5],
        "sites": [
            {"slug": "kilauea", "status": "visible", "passes": [
                {"date": "2025-11-03", "image": "landchange/kilauea/2025-11-03.webp",
                 "hh": "landchange/kilauea/2025-11-03.hh.png"},
            ]},
            {"slug": "home-reef", "status": "not_visible", "reason": "Looks the same."},
        ],
    }))
    monkeypatch.setattr(api, "LANDCHANGE_PATH", path)
    body = client.get("/api/landchange").get_json()
    assert "_note" not in body
    p = body["sites"][0]["passes"][0]
    assert p["image_url"] == "/api/scenes/landchange/kilauea/2025-11-03.webp"
    assert p["hh_url"] == "/api/scenes/landchange/kilauea/2025-11-03.hh.png"
    assert body["sites"][1]["reason"] == "Looks the same."
    assert body["imagery"] == {}


def test_hidden_imagery_is_kept_out_of_the_gallery(client, tmp_path, monkeypatch):
    path = tmp_path / "landchange.json"
    path.write_text(json.dumps({"sites": [
        {"slug": "kilauea", "status": "visible", "passes": []},
        {"slug": "kilauea-tour", "status": "visible", "hidden": True, "passes": [
            {"date": "2025-11-15", "image": "landchange/kilauea-tour/2025-11-15.webp",
             "hh": "landchange/kilauea-tour/2025-11-15.hh.png"},
        ]},
    ]}))
    monkeypatch.setattr(api, "LANDCHANGE_PATH", path)
    body = client.get("/api/landchange").get_json()
    assert [s["slug"] for s in body["sites"]] == ["kilauea"]
    tour = body["imagery"]["kilauea-tour"]
    assert tour["passes"][0]["image_url"] == "/api/scenes/landchange/kilauea-tour/2025-11-15.webp"


def test_landchange_endpoint_without_data(client, tmp_path, monkeypatch):
    monkeypatch.setattr(api, "LANDCHANGE_PATH", tmp_path / "missing.json")
    assert client.get("/api/landchange").get_json() == {"sites": [], "generated_at": None}


def test_hh_layer_quantizes_dB_and_marks_no_data():
    import build_landchange as b

    db = np.array([[-30.0, -30.0, 5.0, 5.0], [-30.0, -30.0, 5.0, 5.0]])
    valid = np.array([[True, True, True, True], [True, True, False, False]])
    img = np.array(b.hh_png(db, valid))
    assert img.shape == (1, 2)
    assert img[0, 0] == 0  # -30 dB
    assert img[0, 1] == 254  # +5 dB (from the two valid pixels)
    none = np.array(b.hh_png(db, np.zeros_like(valid)))
    assert (none == 255).all()


def test_best_frame_keeps_one_pass_per_day_on_the_busiest_frame():
    import build_landchange as b

    def g(frame, day, quality="provisional", n="001"):
        track, ad, fr = frame.split("_")
        return {"title": f"NISAR_L2_PR_GCOV_{n}_{track}_{ad}_{fr}_x", "start": f"{day}T00:00:00Z",
                "quality": quality}

    frame, passes = b.best_frame([
        g("072_D_079", "2025-11-03"), g("072_D_079", "2025-11-03", "validated", "002"),
        g("072_D_079", "2025-11-15"), g("010_A_001", "2025-11-04"),
    ])
    assert frame == "072_D_079"
    assert [p["start"][:10] for p in passes] == ["2025-11-03", "2025-11-15"]
    assert passes[0]["quality"] == "validated"


def test_every_gallery_site_is_documented():
    import build_landchange as b

    for slug, site in b.SITES.items():
        assert site["status"] in ("visible", "likely"), slug
        assert site["headline"] and site["story"] and site["look_for"], slug
        assert 0 < site["half_km"] <= 20, slug
    assert all(s["reason"] for s in b.NOT_VISIBLE)


def test_committed_gallery_text_matches_the_build_script():
    """The JSON is generated: wording changed in one place must be changed in the other."""
    import build_landchange as b

    built = {s["slug"]: s for s in json.loads(api.LANDCHANGE_PATH.read_text(encoding="utf-8"))["sites"]}
    for slug, site in b.SITES.items():
        for key in ("name", "region", "kind", "status", "headline", "story", "look_for"):
            assert built[slug][key] == site[key], (slug, key)
        assert built[slug].get("event") == site.get("event"), slug
        assert [[s["label"], s["url"]] for s in built[slug]["sources"]] == [list(s) for s in site["sources"]], slug
    for site in b.NOT_VISIBLE:
        assert {k: built[site["slug"]][k] for k in ("name", "region", "reason")} == {
            k: site[k] for k in ("name", "region", "reason")
        }, site["slug"]
