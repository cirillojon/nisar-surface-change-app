"""Watch my area (app/watch.py, app/routes/watch.py), replaying Langtang's committed passes."""
import pytest

from app import watch
from pipeline import ingest
from tests.test_pipeline import LAND, _title, fake_render

LANG = LAND["langtang"]
DATES = [p["date"] for p in LANG["passes"]]
BBOX = [LANG["lon"] - 0.05, LANG["lat"] - 0.05, LANG["lon"] + 0.05, LANG["lat"] + 0.05]


@pytest.fixture()
def watches(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATA_DIR", "data")
    monkeypatch.setattr(watch, "_token_available", lambda: True)
    monkeypatch.setattr(watch, "MAX_PER_CHECK", 40)
    monkeypatch.setattr(ingest, "encode_webp", lambda rgb, valid: b"RIFF")
    started = []
    monkeypatch.setattr(watch, "start_check", lambda wid: started.append(wid) or {"state": "queued"})
    return started


def search_upto(day):
    def search(product, bbox, start=None, end=None):
        return [{"title": _title(d), "start": f"{d}T00:15:00Z", "quality": "provisional", "data_url": "x"}
                for d in DATES if d <= day]
    return search


def test_area_from_bbox_squares_and_bounds_the_window():
    a = watch.area_from_bbox(BBOX)
    assert a["lat"] == pytest.approx(LANG["lat"], abs=1e-4) and 4 < a["half_km"] < 6
    assert watch.area_from_bbox([10, 10, 10.001, 10.001])["half_km"] == watch.MIN_HALF_KM
    big = watch.area_from_bbox([10, 10, 10.4, 10.2])
    assert big["clipped"] and big["half_km"] == watch.MAX_HALF_KM
    for bad in ([10, 10, 11, 11], [1, 2, 3], [5, 5, 4, 6], ["a", 1, 2, 3], None):
        with pytest.raises(watch.WatchError):
            watch.area_from_bbox(bad)


def test_create_check_and_flag_a_change_once_it_holds(watches):
    w = watch.create(BBOX, "  My   valley ")
    wid = w["id"]
    assert watch.valid_id(wid) and w["name"] == "My valley" and watches == [wid]
    assert w["status"]["state"] == "queued" and "not a warning" in w["disclaimer"]

    watch.check(wid, search=search_upto("2026-08-31"), render=fake_render)
    w = watch.load(wid)
    assert w["frame"] == "119_A_037" and w["passes"][-1]["date"] == "2026-08-31"
    pending = [c for c in w["candidates"] if c["status"] == "pending"]
    assert pending and pending[0]["end"] == "2026-08-31"
    assert [e["kind"] for e in w["log"]][:2] == ["created", "passes"] and w["log"][-1]["kind"] == "pending"

    watch.check(wid, search=search_upto("2026-09-12"), render=fake_render)
    w = watch.load(wid)
    flagged = [c for c in w["candidates"] if c["status"] == "accepted"]
    assert flagged and (flagged[0]["start"], flagged[0]["end"]) == ("2026-08-19", "2026-08-31")
    change = [e for e in w["log"] if e["kind"] == "change"]
    assert len(change) == 1 and "Worth an expert's look" in change[0]["summary"]

    # Nothing new: nothing logged twice.
    watch.check(wid, search=search_upto("2026-09-12"), render=fake_render)
    assert sum(e["kind"] == "change" for e in watch.load(wid)["log"]) == 1


def test_words_never_state_a_cause():
    c = {"kind": "step", "metric": "water_pct", "start": "2026-01-01", "end": "2026-01-13", "status": "rejected",
         "reason": "within the series' own noise (z = 2.0)", "score": 2.0, "before": 10, "after": 12,
         "change": 2, "days_apart": 12, "noise": 1}
    text = watch.headline(c) + " " + watch.explain(c)
    assert "+2 points" in text and "Not flagged: within" in text
    assert not any(w in f" {text} " for w in (" caused ", " because of ", " due to "))


def test_due_after_refresh_hours():
    from datetime import datetime

    last = "2026-11-25T00:00:00+00:00"
    t = datetime.fromisoformat(last).timestamp()
    assert watch.due({"last_checked": None})
    assert not watch.due({"last_checked": last}, now=t + 3600)
    assert watch.due({"last_checked": last}, now=t + 13 * 3600)


def test_api_round_trip(client, watches):
    r = client.post("/api/watches", json={"bbox": BBOX, "name": "Langtang"})
    assert r.status_code == 201
    wid = r.get_json()["id"]
    watch.check(wid, search=search_upto("2026-09-12"), render=fake_render)

    body = client.get(f"/api/watches/{wid}").get_json()
    assert "state" not in body and body["passes"][0]["image_url"].startswith(f"/api/watches/{wid}/files/auto/")
    assert any(c["status"] == "accepted" and "headline" in c for c in body["candidates"])

    img = client.get(body["passes"][0]["image_url"])
    assert img.status_code == 200 and img.data == b"RIFF"
    img.close()  # Windows can't delete a file still being served
    assert client.get(f"/api/watches/{wid}/files/../watch.json").status_code == 404

    feed = client.get(f"/api/watches/{wid}/feed.atom")
    assert feed.status_code == 200 and feed.mimetype == "application/atom+xml"
    assert b"<feed" in feed.data and f"/watch/{wid}".encode() in feed.data and b"not a warning" in feed.data

    assert client.post("/api/watches", json={"bbox": [0, 0, 5, 5]}).status_code == 400
    assert client.get("/api/watches/nope").status_code == 404
    assert client.delete(f"/api/watches/{wid}").status_code == 204
    assert client.get(f"/api/watches/{wid}").status_code == 404


def test_create_refuses_without_a_token(client, watches, monkeypatch):
    monkeypatch.setattr(watch, "_token_available", lambda: False)
    r = client.post("/api/watches", json={"bbox": BBOX})
    assert r.status_code == 503 and "Earthdata" in r.get_json()["error"]
