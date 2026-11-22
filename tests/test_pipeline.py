"""NISAR Watch (pipeline/): detectors, feeds, targets, templated stories, the run, and the API."""
import json
import re
from argparse import Namespace
from datetime import date
from pathlib import Path

import numpy as np
import pytest

from app import auto
from pipeline import detect, feeds, ingest, publish, run, targets
from pipeline.render import load_hh_layer

ROOT = Path(__file__).resolve().parents[1]
SCENES = ROOT / "app" / "data" / "scenes"
LAND = {s["slug"]: s for s in json.loads((ROOT / "app/data/landchange.json").read_text(encoding="utf-8"))["sites"]}
CAUSAL = (" caused ", " causes ", " proves ", " because of ", " due to ")


def series(values, start="2026-01-01", gap=12, modes=None):
    d0 = date.fromisoformat(start).toordinal()
    return [{"date": date.fromordinal(d0 + i * gap).isoformat(), "value": v,
             "mode": (modes[i] if modes else "4005_DHDH")} for i, v in enumerate(values)]


def layers(slug):
    return [(p["date"], load_hh_layer(SCENES / p["hh"])) for p in LAND[slug]["passes"]]


# ── one number per pass ───────────────────────────────────

def test_step_finds_a_change_that_holds():
    c = detect.step(series([10, 10.5, 9.8, 10.2, 30, 31, 30.5]), "water_pct")
    assert c["status"] == "accepted" and c["before"] == 10.2 and c["after"] == 30
    assert c["held_value"] == 31 and c["days_apart"] == 12


@pytest.mark.parametrize("values, modes, reason", [
    ([10, 11, 9, 10.5, 9.5, 10, 11], None, "under"),                                   # noise only
    ([10, 10.5, 10.2, 30, 9.8, 10.4, 10.1], None, "spike"),                            # Punjab-style one-pass spike
    ([10, 10.5, 9.8, 10.2, 30, 31, 30.5], ["A"] * 4 + ["B"] * 3, "acquisition modes"),  # Sylhet-style mode change
    ([10, 10.5, 9.8, 10.2, 10.1, 10.3, 30], None, "pending"),                          # newest pass: not checked yet
    ([10, 10.5, 9.8, 10.2, 30, 12, 16], None, "did not hold"),
])
def test_step_rejects_noise_artifacts_and_unconfirmed_change(values, modes, reason):
    c = detect.step(series(values, modes=modes), "water_pct")
    assert c["status"] != "accepted" and reason in c["reason"]
    assert c["status"] == ("pending" if reason == "pending" else "rejected")


def test_trend_needs_a_line_that_fits():
    rng = np.random.default_rng(1)
    good = detect.trend(series(list(-0.3 * np.arange(10) + rng.normal(0, 0.1, 10))), "hh_db")
    assert good["status"] == "accepted" and good["r2"] >= 0.8 and good["rate_per_month"] < 0
    noisy = detect.trend(series(list(-0.2 * np.arange(10) + rng.normal(0, 1.5, 10))), "hh_db")
    assert noisy["status"] == "rejected"
    assert detect.trend(series([1, 2, 3]), "hh_db") is None


def test_trend_uses_only_the_commonest_mode():
    vals = [0, 0, 0, 0, 0, 0, 0, 0, 5, 5]
    c = detect.trend(series(vals, modes=["A"] * 8 + ["B"] * 2), "hh_db")
    assert c is None or c["passes"] == 8 and c["status"] == "rejected"


# ── per-pixel change, replayed on the gallery's committed passes ──

@pytest.mark.parametrize("slug, start, end", [
    ("langtang", "2026-08-19", "2026-08-31"),
    ("budhi-gandaki", "2026-10-06", "2026-10-18"),
    ("bang-pakong", "2026-09-18", "2026-09-30"),
])
def test_patch_detector_refinds_the_changes_we_picked_by_hand(slug, start, end):
    found = detect.patches(layers(slug), LAND[slug]["pixel_m"])
    hit = [c for c in found if (c["start"], c["end"]) == (start, end)]
    assert hit and hit[0]["status"] == "accepted", found
    assert hit[0]["held_share"] >= detect.PERSIST


def test_patch_detector_drops_passing_change():
    """Etna's 9-21 Sep pair has the largest patch but it had gone by the next pass."""
    found = {(c["start"], c["end"]): c for c in detect.patches(layers("etna"), LAND["etna"]["pixel_m"])}
    c = found[("2026-09-09", "2026-09-21")]
    assert c["status"] == "rejected" and "passing change" in c["reason"]


def test_patch_detector_skips_area_wide_change_and_quiet_places():
    rng = np.random.default_rng(0)
    base = rng.normal(-10, 0.5, (60, 60))
    quiet = [(f"2026-0{i + 1}-01", base + rng.normal(0, 0.5, base.shape)) for i in range(6)]
    assert not [c for c in detect.patches(quiet, 20) if c["status"] == "accepted"]
    wide = list(quiet)
    wide[3] = (wide[3][0], wide[3][1] + np.where(np.arange(60)[:, None] < 40, 8, 0))
    wide[4] = (wide[4][0], wide[4][1] + np.where(np.arange(60)[:, None] < 40, 8, 0))
    hits = [c for c in detect.patches(wide, 20) if c["start"] == wide[2][0]]
    assert hits and hits[0]["status"] == "rejected" and "area-wide" in hits[0]["reason"]


def test_change_map_matches_the_browser_rules():
    a = np.full((20, 20), -10.0)
    b = a.copy()
    b[5:10, 5:10] = 0.0  # +10 dB block
    a[15:, 15:] = b[15:, 15:] = -25.0  # water on both dates: left out
    d, land, shift = detect.change_map(a, b)
    assert shift == pytest.approx(0, abs=1e-9)
    assert not land[18, 18] and land[7, 7]
    assert d[7, 7] > detect.CHANGED_DB


# ── event feeds ───────────────────────────────────────────

def test_feeds_normalize_eonet_usgs_and_gdacs():
    eonet = feeds.parse_eonet({"events": [
        {"id": "EONET_1", "title": "Mayon Volcano, Philippines", "categories": [{"id": "volcanoes"}],
         "sources": [{"url": "https://volcano.si.edu/x"}],
         "geometry": [{"date": "2026-11-02T00:00:00Z", "type": "Point", "coordinates": [123.68, 13.26]}]},
        {"id": "EONET_2", "title": "Storm", "categories": [{"id": "severeStorms"}],
         "geometry": [{"date": "2026-11-02T00:00:00Z", "type": "Point", "coordinates": [0, 0]}]},
    ]})
    assert [e["kind"] for e in eonet] == ["Volcano"] and eonet[0]["date"] == "2026-11-02"
    usgs = feeds.parse_usgs({"features": [
        {"id": "us1", "properties": {"mag": 7.1, "time": 1793577600000, "title": "M 7.1 - Somewhere", "url": "u"},
         "geometry": {"coordinates": [140.0, 35.0, 10.0]}},
        {"id": "us2", "properties": {"mag": 6.5, "time": 1793577600000}, "geometry": {"coordinates": [1, 2, 300]}},
        {"id": "us3", "properties": {"mag": 5.0, "time": 1793577600000}, "geometry": {"coordinates": [1, 2, 5]}},
    ]})
    assert [e["id"] for e in usgs] == ["usgs:us1"] and usgs[0]["kind"] == "Earthquake"
    gdacs = feeds.parse_gdacs({"features": [
        {"geometry": {"type": "Point", "coordinates": [67.7, 26.4]},
         "properties": {"eventtype": "FL", "eventid": 9, "name": "Flood in Pakistan", "fromdate": "2026-10-20T00:00:00",
                        "url": {"report": "https://gdacs.org/r"}, "alertlevel": "Red"}},
        {"geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {"eventtype": "TC", "eventid": 1}},
    ]})
    assert gdacs == [{"id": "gdacs:FL9", "source": "GDACS", "kind": "Flood", "title": "Flood in Pakistan",
                      "date": "2026-10-20", "lon": 67.7, "lat": 26.4, "url": "https://gdacs.org/r",
                      "magnitude": None, "alert": "Red"}]


def test_a_feed_outage_does_not_stop_the_others(monkeypatch):
    def fake_get(url, params=None):
        if "usgs" in url:
            raise feeds.requests.ConnectionError("down")
        return {"events": [], "features": []}
    monkeypatch.setattr(feeds, "_get", fake_get)
    events, errors = feeds.fetch_events(today=date(2026, 11, 15))
    assert events == [] and len(errors) == 1 and errors[0].startswith("USGS")


# ── targets ───────────────────────────────────────────────

def event(id_, kind="Volcano", lon=100.0, lat=10.0, day="2026-11-01", title="Somewhere"):
    return {"id": id_, "source": "NASA EONET", "kind": kind, "title": title, "date": day,
            "lon": lon, "lat": lat, "url": "https://example.org", "magnitude": None}


def test_watchlist_slugs_are_prefixed_and_unique():
    watch = targets.load_watchlist()
    slugs = [t["slug"] for t in watch]
    assert len(slugs) == len(set(slugs)) and all(s.startswith("auto-") for s in slugs)
    assert not set(slugs) & set(LAND)
    assert all(t["theme"] in {"water", "food", "ground", "ice", "forest"} for t in watch)


def test_events_become_expiring_targets_once_and_skip_watched_places():
    watch = targets.load_watchlist()
    mayon = next(t for t in watch if t["slug"] == "auto-mayon")
    today = date(2026, 11, 15)
    evs = [event("a", lon=mayon["lon"] + 0.01, lat=mayon["lat"]),     # inside a watched window
           event("b", title="New vent"), event("b", title="New vent"),  # duplicate id
           event("c", kind="Drought"),                                  # not a kind we watch
           event("d", day="2026-08-01", lon=-50, lat=-20)]              # already expired
    alive, skipped = targets.merge_events(watch, [], evs, today)
    assert [t["event"]["id"] for t in alive] == ["b"]
    t = alive[0]
    assert t["slug"].startswith("auto-volcano-new-vent") and t["start"] == "2026-09-14" and t["expires"] == "2026-12-31"
    assert {s["why"].split()[0] for s in skipped} == {"already", "Drought"}
    again, _ = targets.merge_events(watch, alive, evs, today)
    assert len(again) == 1
    assert targets.merge_events(watch, alive, [], date(2027, 1, 1))[0] == []


def test_event_targets_are_capped_per_run():
    evs = [event(str(i), lon=10 * i - 170, lat=0) for i in range(12)]
    alive, skipped = targets.merge_events([], [], evs, date(2026, 11, 15))
    assert len(alive) == targets.MAX_NEW_EVENTS and sum("cap" in s["why"] for s in skipped) == 12 - targets.MAX_NEW_EVENTS


# ── templated stories ─────────────────────────────────────

PLACE = {"slug": "auto-x", "name": "Test Lake", "region": "Nowhere", "kind": "Lake", "theme": "water",
         "watch": {"origin": "watchlist", "event": None}}


def _numbers(text):
    return {float(n.replace("−", "-")) for n in re.findall(r"−?\d+(?:\.\d+)?", text)}


def check_story(story, candidate):
    """Wording rules every auto story must keep."""
    text = " ".join([story["title"], story["summary"], story["question"], story["place"], *story["cant_see"]])
    assert not any(w in f" {text.lower()} " for w in CAUSAL), text
    allowed = set()
    for v in candidate.values():
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            allowed |= {round(abs(v), 2), round(abs(v), 1), float(round(abs(v))), round(abs(v) * 100)}
        if isinstance(v, str) and re.match(r"\d{4}-\d\d-\d\d$", v):
            y, _, d = v.split("-")
            allowed |= {float(y), float(int(d))}
    allowed |= {4.0, 5.0, 18.0, 12.0}  # the method's own constants (4 dB, 5 x 5, -18 dB, 12-day repeat)
    stray = {abs(n) for n in _numbers(story["summary"] + story["title"] + story["channel"])} - allowed
    assert not stray, (stray, story["summary"])
    assert story["origin"] == "auto" and story["hypotheses"] == [] and story["status_label"] == auto.STATUS_LABEL


def test_step_and_trend_text_only_holds_measured_numbers():
    c = detect.step(series([10.1, 10.6, 9.8, 10.2, 30.4, 31.2, 30.5]), "water_pct")
    s = publish.build_story(PLACE, c, "2026-11-15")
    check_story(s, c)
    assert "rose from 10.2% on 6 Feb 2026 to 30.4% on 18 Feb 2026" in s["summary"]
    rng = np.random.default_rng(1)
    t = detect.trend(series(list(-0.3 * np.arange(10) + rng.normal(0, 0.1, 10))), "hh_db")
    check_story(publish.build_story(PLACE, t, "2026-11-15"), t)


def test_patch_text_only_holds_measured_numbers():
    c = next(c for c in detect.patches(layers("langtang"), 26) if c["status"] == "accepted")
    s = publish.build_story(PLACE | {"kind": "Landslide", "theme": "ground"}, c, "2026-11-15")
    check_story(s, c)
    assert s["pair"] == [c["start"], c["end"]] and s["cant_see"][0].startswith("The slide's outline")


def test_event_context_is_never_a_cause():
    ev = {"id": "x", "source": "USGS", "title": "M 7.1 - Somewhere", "date": "2026-01-20", "url": "u"}
    place = PLACE | {"watch": {"origin": "event", "event": ev}}
    c = detect.step(series([10.1, 10.6, 9.8, 10.2, 30.4, 31.2, 30.5]), "water_pct")
    s = publish.build_story(place, c, "2026-11-15")
    assert "Reported nearby: M 7.1 - Somewhere (USGS, 20 Jan 2026)" in s["place"]
    assert "doesn't show what drove" in s["place"] and s["event_date"] == "2026-01-20"
    check_story(s, c)


def test_event_places_publish_only_change_spanning_the_event():
    ev = {"id": "x", "source": "USGS", "title": "Quake", "date": "2026-03-01", "url": "u"}
    place = PLACE | {"watch": {"origin": "event", "event": ev}}
    c = detect.step(series([10.1, 10.6, 9.8, 10.2, 30.4, 31.2, 30.5]), "water_pct")  # 13-25 Jan
    assert publish.update(None, place, [c], "2026-11-15") == (None, "none")
    assert publish.update(None, PLACE, [c], "2026-11-15")[1] == "new"


def test_a_story_evolves_keeps_history_and_respects_retraction():
    c1 = detect.step(series([10.1, 10.6, 9.8, 10.2, 30.4, 31.2, 30.5]), "water_pct")
    s1, action = publish.update(None, PLACE, [c1], "2026-02-10")
    assert action == "new"
    assert publish.update(s1, PLACE, [c1], "2026-02-22") == (s1, "unchanged")
    assert publish.update(s1, PLACE, [], "2026-02-22") == (s1, "unchanged")
    c2 = detect.step(series([10.1, 10.6, 9.8, 10.2, 10.4, 10.0, 10.3, 40, 41, 40.5]), "water_pct")
    s2, action = publish.update(s1, PLACE, [c2], "2026-03-30")
    assert action == "updated" and s2["detected_at"] == "2026-02-10" and s2["updated_at"] == "2026-03-30"
    assert s2["history"][0]["pair"] == s1["pair"] and s2["pair"] == [c2["start"], c2["end"]]
    retracted = s2 | {"status": "retracted", "retracted_reason": "Wind on the lake"}
    assert publish.update(retracted, PLACE, [c2], "2026-04-11") == (retracted, "unchanged")


# ── the run, end to end, replaying Langtang's committed passes ──

def _title(day):
    return f"NISAR_L2_PR_GCOV_001_119_A_037_4005_DHDH_A_{day.replace('-', '')}T001500_{day.replace('-', '')}T001530_P05006_N_F_J_001"


def fake_render(job):
    """Stands in for the range reads: the gallery's committed HH layer, upsampled."""
    slug, g, *_ = job
    day = g["start"][:10]
    hh = np.kron(load_hh_layer(SCENES / f"landchange/langtang/{day}.hh.png"), np.ones((2, 2)))
    valid = np.isfinite(hh)
    rgb = np.dstack([np.clip(np.nan_to_num(hh, nan=-30) + 30, 0, 35) * 7] * 3)
    return slug, g, (rgb, hh, valid, "HH+HV", hh - 7), "replayed"


@pytest.fixture()
def store(tmp_path, monkeypatch):
    lang = LAND["langtang"]
    (tmp_path / "watchlist.json").write_text(json.dumps({"targets": [
        {"slug": "langtang", "name": "Langtang Lirung", "region": "Nepal", "kind": "Landslide",
         "lon": lang["lon"], "lat": lang["lat"], "half_km": 6.0}]}))
    monkeypatch.setattr(targets, "WATCHLIST_PATH", tmp_path / "watchlist.json")
    monkeypatch.setattr(ingest, "encode_webp", lambda rgb, valid: b"RIFF")  # the real encoder is slow
    return lambda: run.Store(tmp_path / "places.json", tmp_path / "stories.json", tmp_path / "state.json",
                             tmp_path / "scenes")


def _args(**kw):
    return Namespace(**({"today": None, "no_events": True, "target": None, "dry_run": False,
                         "max_passes": 150, "max_per_target": 40, "workers": 1} | kw))


def test_run_ingests_only_new_passes_and_publishes_once_the_change_holds(store, tmp_path):
    dates = [p["date"] for p in LAND["langtang"]["passes"]]
    upto = {"day": "2026-08-31"}
    calls = []

    def search(product, bbox, start=None, end=None):
        calls.append(bbox)
        return [{"title": _title(d), "start": f"{d}T00:15:00Z", "quality": "provisional", "data_url": "x"}
                for d in dates if d <= upto["day"]]

    assert run.cmd_run(_args(today="2026-09-01"), store(), search=search, render=fake_render) == 0
    s = store()
    place = s.places["auto-langtang"]
    assert place["frame"] == "119_A_037" and place["passes"][-1]["date"] == "2026-08-31"
    assert set(place["passes"][0]["stats"]) == {"hh_db", "water_pct", "hv_db"}
    assert (tmp_path / "scenes" / place["passes"][0]["hh"]).is_file()
    pending = [c for c in s.state["targets"]["auto-langtang"]["candidates"] if c["status"] == "pending"]
    assert pending and pending[0]["end"] == "2026-08-31"
    assert "auto-langtang" not in s.stories  # can't tell yet whether it holds

    upto["day"] = "2026-09-12"
    rendered = []
    assert run.cmd_run(_args(today="2026-09-13"), s, search=search,
                       render=lambda j: rendered.append(j[1]["start"][:10]) or fake_render(j)) == 0
    assert rendered == ["2026-09-12"]  # only the new pass
    s = store()
    story = s.stories["auto-langtang"]
    assert story["pair"] == ["2026-08-19", "2026-08-31"] and story["detected_at"] == "2026-09-13"
    assert story["status"] == "active" and story["detector"] == "patch"
    check_story(story, story["detection"])

    # Nothing new: nothing rendered, nothing rewritten.
    rendered.clear()
    run.cmd_run(_args(today="2026-09-14"), s, search=search, render=lambda j: rendered.append(1) or fake_render(j))
    assert rendered == [] and store().stories["auto-langtang"]["updated_at"] == "2026-09-13"


def test_summary_says_why_each_candidate_was_rejected():
    rejected = {"kind": "step", "metric": "hh_db", "start": "2026-09-01", "end": "2026-09-13",
                "status": "rejected", "reason": "within the place's own noise", "score": 1.2}
    text = run.summary("2026-09-14", {"auto-x": {"rendered": []}},
                       {"auto-x": {"candidates": [rejected], "action": None}}, [], [], [], False)
    assert "auto-x: step hh_db 2026-09-01 → 2026-09-13: within the place's own noise (score 1.2)" in text


def test_dry_run_writes_nothing(store, tmp_path):
    def search(product, bbox, start=None, end=None):
        return [{"title": _title("2026-08-19"), "start": "2026-08-19T00:15:00Z", "data_url": "x"}]

    assert run.cmd_run(_args(dry_run=True), store(), search=search, render=fake_render) == 0
    assert not (tmp_path / "places.json").exists() and not (tmp_path / "scenes").exists()


def test_a_failed_search_is_reported_not_fatal(store, capsys):
    def search(*a, **k):
        raise RuntimeError("CMR is down")

    assert run.cmd_run(_args(), store(), search=search, render=fake_render) == 1
    assert "search failed: CMR is down" in capsys.readouterr().out


# ── the app serves auto stories ───────────────────────────

@pytest.fixture()
def published(store, tmp_path, monkeypatch):
    dates = [p["date"] for p in LAND["langtang"]["passes"]]

    def search(product, bbox, start=None, end=None):
        return [{"title": _title(d), "start": f"{d}T00:15:00Z", "quality": "provisional", "data_url": "x"}
                for d in dates if d <= "2026-09-12"]

    run.cmd_run(_args(today="2026-09-13"), store(), search=search, render=fake_render)
    monkeypatch.setattr(auto, "PLACES_PATH", tmp_path / "places.json")
    monkeypatch.setattr(auto, "STORIES_PATH", tmp_path / "stories.json")
    return "auto-langtang"


def test_api_lists_filters_and_pages_auto_stories(client, published):
    body = client.get("/api/stories").get_json()
    row = next(s for s in body["stories"] if s["slug"] == published)
    assert row["origin"] == "auto" and row["date"] == "2026-08-31" and row["status_label"] == auto.STATUS_LABEL
    assert row["thumb_date"] == "2026-08-31" and row["detected_at"] == "2026-09-13"
    only = client.get("/api/stories?origin=auto").get_json()["stories"]
    assert [s["slug"] for s in only] == [published]
    assert all(s["origin"] == "curated" for s in client.get("/api/stories?origin=curated").get_json()["stories"])
    dated = client.get("/api/stories?since=2026-08-31&until=2026-08-31").get_json()["stories"]
    assert published in [s["slug"] for s in dated] and all(s["date"] == "2026-08-31" for s in dated)
    feed = client.get("/api/stories/feed?limit=3").get_json()
    assert feed["count"] == 3 and feed["next_offset"] == 3 and feed["total"] == body["count"]
    days = [s["date"] for s in feed["stories"]]
    assert days == sorted(days, reverse=True) and feed["latest_detection"] == "2026-09-13"
    for bad in ("since=yesterday", "origin=robot", "since=2026-02-01&until=2026-01-01", "sort=random"):
        assert client.get(f"/api/stories?{bad}").status_code == 400, bad
    assert client.get("/api/stories/feed?limit=0").status_code == 400


def test_auto_story_finding_and_gallery(client, published):
    story = client.get(f"/api/stories/{published}").get_json()
    assert story["status_label"] == auto.STATUS_LABEL and story["saw"]["suggested"] == ["2026-08-19", "2026-08-31"]
    f = client.get(f"/api/findings/{published}").get_json()
    assert f["claim"]["measured"] is True and f["story"]["origin"] == "auto"
    assert f["claim"]["start"] == "2026-08-19" and f["evidence"]["detection"]["kind"] == "patch"
    gallery = client.get("/api/landchange").get_json()["sites"]
    place = next(s for s in gallery if s["slug"] == published)
    assert place["status"] == "auto" and place["passes"][0]["hh_url"].startswith("/api/scenes/auto/")
    from app import tools
    listed = tools.list_land_change("landslide")["sites"]
    assert any(s["slug"] == published and s["status"] == auto.STATUS_LABEL.lower() for s in listed)
    assert [s["slug"] for s in tools.list_stories_tool(origin="auto")["stories"]] == [published]


def test_retracted_and_watch_only_places_stay_hidden(client, published, tmp_path):
    data = json.loads((tmp_path / "stories.json").read_text())
    data["stories"][0] |= {"status": "retracted", "retracted_reason": "Snow"}
    (tmp_path / "stories.json").write_text(json.dumps(data))
    assert client.get(f"/api/stories/{published}").status_code == 404
    assert published not in [s["slug"] for s in client.get("/api/landchange").get_json()["sites"]]


# ── what the watch job commits ────────────────────────────

def test_committed_auto_stories_keep_the_rules():
    """Runs in the watch job before anything is published (see nisar-watch.yml)."""
    places = {p["slug"]: p for p in auto.places()}
    themes = {"water", "food", "ground", "ice", "forest"}
    for story in auto.all_stories():
        assert story["slug"].startswith(targets.PREFIX) and story["slug"] not in LAND
        assert story["theme"] in themes and story["status"] in ("active", "retracted", "superseded")
        place = places[story["slug"]]
        days = {p["date"] for p in place["passes"]}
        assert set(story["pair"]) <= days, story["slug"]
        for p in place["passes"]:
            assert (SCENES / p["image"]).is_file() and (SCENES / p["hh"]).is_file(), (story["slug"], p["date"])
        check_story(story, story["detection"])
        assert story["summary"] == publish.build_story(place, story["detection"], story["detected_at"])["summary"]


def test_token_check_reads_the_jwt_expiry(monkeypatch, capsys):
    import base64

    def jwt(exp):
        body = base64.urlsafe_b64encode(json.dumps({"exp": exp}).encode()).decode().rstrip("=")
        return f"eyJhbGciOiJSUzI1NiJ9.{body}.sig"

    assert run.token_days_left(jwt(86400 * 3), now=0) == 3 and run.token_days_left("opaque") is None
    monkeypatch.setenv("EARTHDATA_TOKEN", jwt(1))
    assert run.main(["check-token"]) == 1 and "expired" in capsys.readouterr().out
    monkeypatch.setenv("EARTHDATA_TOKEN", jwt(__import__("time").time() + 86400 * 5))
    assert run.main(["check-token"]) == 0 and "::warning::" in capsys.readouterr().out
    monkeypatch.delenv("EARTHDATA_TOKEN")
    assert run.main(["check-token"]) == 1
