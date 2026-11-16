def test_list_sites_empty(client):
    r = client.get("/api/sites")
    assert r.status_code == 200
    body = r.get_json()
    assert body["sites"] == []
    assert body["total"] == 0


def test_change_types_list_their_metrics(client):
    r = client.get("/api/change-types")
    assert r.status_code == 200
    by_id = {ct["id"]: ct for ct in r.get_json()["change_types"]}
    assert by_id["subsidence"]["product"] == "GUNW"
    assert by_id["agriculture"]["metrics"][0] == {
        "id": "hv_db", "label": "HV backscatter", "unit": "dB",
        "description": by_id["agriculture"]["metrics"][0]["description"],
    }


def test_get_site_includes_series_and_scenes(client, seeded_site):
    r = client.get(f"/api/sites/{seeded_site.id}")
    assert r.status_code == 200
    body = r.get_json()
    assert body["name"] == "Test Basin"
    assert body["bbox"] == [-99.2, 19.2, -98.8, 19.6]
    assert body["reference"] == [-99.15, 19.3]
    # No story is configured for this slug, so the site panel charts every metric.
    assert body["story_metric"] is None
    assert [(o["metric"], o["value"]) for o in body["observations"]] == [
        ("los_mm", 0.0), ("los_mm", -12.5),
    ]
    assert [s["image_url"] for s in body["scenes"]] == [
        "/api/scenes/test-subsidence/2026-06-01.webp",
        "/api/scenes/test-subsidence/2026-06-13.webp",
    ]


def test_list_reports_scene_dates(client, app, seeded_site):
    from app import db
    from app.models import Site

    db.session.add(Site(
        name="Empty", change_type="subsidence", latitude=1, longitude=1,
        min_lon=0.75, min_lat=0.75, max_lon=1.25, max_lat=1.25,
    ))
    db.session.commit()
    by_name = {s["name"]: s for s in client.get("/api/sites").get_json()["sites"]}
    basin = by_name["Test Basin"]
    assert (basin["scene_count"], basin["first_date"], basin["last_date"]) == (
        2, "2026-06-01", "2026-06-13",
    )
    assert "observations" not in basin
    assert by_name["Empty"]["scene_count"] == 0
    # A list row carries its newest pass's image, for the list's thumbnail.
    assert basin["thumb_url"] == "/api/scenes/test-subsidence/2026-06-13.webp"
    assert by_name["Empty"]["thumb_url"] is None
    detail = client.get(f"/api/sites/{seeded_site.id}").get_json()
    assert detail["thumb_url"] == basin["thumb_url"]


def test_get_missing_returns_json_404(client):
    r = client.get("/api/sites/999")
    assert r.status_code == 404
    assert "error" in r.get_json()


def test_filter_by_change_type(client, seeded_site):
    assert client.get("/api/sites?change_type=subsidence").get_json()["total"] == 1
    assert client.get("/api/sites?change_type=agriculture").get_json()["total"] == 0
    assert client.get("/api/sites?change_type=bogus").status_code == 400


def test_scene_images_are_served_and_confined(client, tmp_path, monkeypatch):
    from app.routes import api

    (tmp_path / "site").mkdir()
    (tmp_path / "site" / "2026-06-01.webp").write_bytes(b"RIFF....WEBP")
    monkeypatch.setattr(api, "SCENES_DIR", tmp_path)
    r = client.get("/api/scenes/site/2026-06-01.webp")
    assert r.status_code == 200
    assert r.data == b"RIFF....WEBP"
    assert r.mimetype == "image/webp"
    assert client.get("/api/scenes/../sites.json").status_code == 404
