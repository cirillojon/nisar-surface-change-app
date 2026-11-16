def test_health_ok(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.get_json()
    assert body["status"] == "ok"
    assert body["site_count"] == 0
    assert body["sources"] == []


def test_health_after_loader(client, app):
    """Once the loader has run, /api/health surfaces the LoadJob row."""
    from app import loader

    with app.app_context():
        loader.load(force=True)

    r = client.get("/api/health")
    body = r.get_json()
    assert r.status_code == 200
    assert body["status"] == "ok"
    assert body["site_count"] > 0
    assert len(body["sources"]) == 1
    assert body["sources"][0]["source_id"] == "nisar_sites"
    assert body["last_load_at"] is not None
