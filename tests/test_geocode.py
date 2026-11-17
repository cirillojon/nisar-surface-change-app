"""Place search (/api/geocode) over OpenStreetMap's Nominatim."""
import pytest
import requests

from app import geocode

_ROWS = [
    {
        "name": "Lake Chad",
        "display_name": "Lake Chad, Chad",
        "addresstype": "water",
        "lat": "13.2",
        "lon": "14.1",
        "boundingbox": ["12.3", "14.4", "13.0", "15.2"],
    },
    # No position: left out.
    {"name": "Nowhere", "display_name": "Nowhere"},
]


class _Response:
    def __init__(self, body, error=None):
        self._body = body
        self._error = error

    def raise_for_status(self):
        if self._error:
            raise self._error

    def json(self):
        return self._body


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    geocode.clear_cache()
    # No real waiting between requests in tests.
    monkeypatch.setattr(geocode, "_MIN_INTERVAL_SECONDS", 0.0)
    yield
    geocode.clear_cache()


@pytest.fixture()
def nominatim(monkeypatch):
    calls = []

    def _get(url, params=None, headers=None, timeout=None):
        calls.append({"url": url, "params": params, "headers": headers})
        return _Response(_ROWS)

    monkeypatch.setattr(geocode.requests, "get", _get)
    return calls


def test_search_returns_places_with_lon_lat_boxes(client, nominatim):
    r = client.get("/api/geocode?q=lake%20chad")
    assert r.status_code == 200
    body = r.get_json()
    assert body["query"] == "lake chad"
    assert body["results"] == [{
        "name": "Lake Chad",
        "label": "Lake Chad, Chad",
        "kind": "water",
        "latitude": 13.2,
        "longitude": 14.1,
        "bbox": [13.0, 12.3, 15.2, 14.4],
    }]
    assert "OpenStreetMap" in body["attribution"]["text"]
    # Identified, as Nominatim's usage policy asks.
    assert nominatim[0]["headers"]["User-Agent"] == geocode.USER_AGENT
    assert nominatim[0]["params"]["format"] == "jsonv2"


def test_repeated_searches_are_cached(client, nominatim):
    client.get("/api/geocode?q=Lake  Chad")
    client.get("/api/geocode?q=lake chad")
    assert len(nominatim) == 1


def test_short_or_missing_queries_are_rejected(client, nominatim):
    assert client.get("/api/geocode").status_code == 400
    assert client.get("/api/geocode?q=a").status_code == 400
    assert client.get("/api/geocode?q=" + "x" * 121).status_code == 400
    assert nominatim == []


def test_upstream_failure_is_a_502(client, monkeypatch):
    def _get(*args, **kwargs):
        return _Response(None, error=requests.HTTPError("503"))

    monkeypatch.setattr(geocode.requests, "get", _get)
    r = client.get("/api/geocode?q=Phoenix")
    assert r.status_code == 502
    assert r.get_json()["error"] == "Place search is temporarily unavailable."


def test_geocoder_url_can_be_configured(client, nominatim, monkeypatch):
    monkeypatch.setenv("GEOCODER_URL", "https://geocoder.example/search")
    client.get("/api/geocode?q=Phoenix")
    assert nominatim[0]["url"] == "https://geocoder.example/search"
