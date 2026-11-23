"""NISAR's computed ground track (app/orbit.py, /api/nisar/orbit)."""
from datetime import datetime, timedelta, timezone

import pytest
import requests

from app import orbit

# NISAR's elements as published by CelesTrak (epoch 2026-11-22T14:13:33Z).
_TLE = """NISAR
1 65053U 25163A   26326.59275348  .00000263  00000+0  92342-4 0  9992
2 65053  98.4063 151.9769 0001247  90.4577 269.6756 14.42501791 69229
"""
_EPOCH = datetime(2026, 11, 22, 14, 13, 33, tzinfo=timezone.utc)


class _Resp:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    orbit.clear_cache()
    yield
    orbit.clear_cache()


@pytest.fixture()
def celestrak(monkeypatch):
    calls = []

    def fake_get(url, **kwargs):
        calls.append(kwargs.get("params"))
        return _Resp(_TLE)

    monkeypatch.setattr(orbit.requests, "get", fake_get)
    return calls


def test_parse_tle_checks_the_satellite():
    line1, line2 = orbit.parse_tle(_TLE)
    assert line1.startswith("1 65053U") and line2.startswith("2 65053")
    with pytest.raises(ValueError):
        orbit.parse_tle(_TLE.replace("65053", "25544"))
    with pytest.raises(ValueError):
        orbit.parse_tle("No GP data found")


def test_ground_track_is_nisars_orbit(celestrak):
    track = orbit.ground_track(_EPOCH, _EPOCH + timedelta(minutes=200), 60)
    points = track["points"]
    assert len(points) == 201 and points[-1][0] == 200 * 60
    assert track["inclination_deg"] == pytest.approx(98.406, abs=0.01)
    assert track["period_min"] == pytest.approx(99.8, abs=0.2)
    lats = [p[2] for p in points]
    # Sun-synchronous at 98.4°: the track turns at 180 - 98.4 = 81.6° N and S.
    assert 81 < max(lats) < 82 and -82 < min(lats) < -81
    # ~747 km nominal; height above the ellipsoid varies with latitude.
    assert all(745 < p[3] < 785 for p in points)
    assert all(-180 <= p[1] <= 180 for p in points)


def test_ground_track_matches_a_real_acquisition(celestrak):
    # GSLC 036_048_D_084 began at 2026-11-20T13:03:48Z; its frame lies
    # 430-700 km left of the track (NISAR looks left), centered near 81.06°E 9.71°N.
    t = datetime(2026, 11, 20, 13, 3, 48, tzinfo=timezone.utc)
    lon, lat = orbit.ground_track(t, t + timedelta(seconds=10), 10)["points"][0][1:3]
    assert lon == pytest.approx(76.1, abs=0.3) and lat == pytest.approx(11.1, abs=0.3)


def test_elements_are_cached_and_reused_when_celestrak_fails(celestrak, monkeypatch):
    first = orbit.current_elements()
    orbit.current_elements()
    assert len(celestrak) == 1 and first["stale"] is False

    # Expired, and CelesTrak is down: the old copy is used, marked stale.
    orbit.clear_cache()
    monkeypatch.setattr(orbit, "TLE_TTL_SECONDS", -1)

    def down(*args, **kwargs):
        raise requests.ConnectionError("down")

    monkeypatch.setattr(orbit.requests, "get", down)
    stale = orbit.current_elements()
    assert stale["stale"] is True and stale["line1"] == first["line1"]


def test_no_elements_at_all_is_an_error(monkeypatch):
    def down(*args, **kwargs):
        raise requests.ConnectionError("down")

    monkeypatch.setattr(orbit.requests, "get", down)
    with pytest.raises(orbit.OrbitError):
        orbit.current_elements()


def test_orbit_endpoint(client, celestrak):
    resp = client.get("/api/nisar/orbit?start=2026-11-22T00:00:00Z&end=2026-11-22T06:00:00Z&step=120")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["start"] == "2026-11-22T00:00:00Z" and len(body["points"]) == 181
    assert body["elements"]["line1"].startswith("1 65053U")

    for query in (
        "start=yesterday",
        "start=2026-11-22T00:00:00Z&end=2026-11-21T00:00:00Z",
        "start=2026-11-20T00:00:00Z&end=2026-11-29T00:00:00Z",  # longer than 7 days
        "start=2026-11-22T00:00:00Z&step=5",
        "start=2026-01-01T00:00:00Z",  # far from the elements' epoch
    ):
        assert client.get(f"/api/nisar/orbit?{query}").status_code == 400, query
