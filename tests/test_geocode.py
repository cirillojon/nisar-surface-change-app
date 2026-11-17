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


def test_find_place_tool_gives_a_search_box(client, monkeypatch):
    from app import tools

    places = [
        {"name": "Lake Chad", "label": "Lake Chad, Africa", "kind": "lake",
         "latitude": 13.2, "longitude": 14.1, "bbox": [13.0, 12.3, 15.2, 14.5]},
        {"name": "Brazil", "label": "Brazil", "kind": "country",
         "latitude": -10.3, "longitude": -53.2, "bbox": [-74.0, -33.8, -28.6, 5.3]},
    ]
    monkeypatch.setattr(geocode, "search", lambda q, session=None: places)
    r = client.post("/api/tools/find_place", json={"query": "  lake   chad "})
    assert r.status_code == 200
    result = r.get_json()["result"]
    assert result["query"] == "lake chad"
    lake, country = result["results"]
    assert lake["search_bbox"] == [13.0, 12.3, 15.2, 14.5] and not lake["search_bbox_clipped"]
    # A country is searched as a 3° box around its centre.
    assert country["search_bbox"] == [-54.7, -11.8, -51.7, -8.8] and country["search_bbox_clipped"]
    assert result["attribution"] == geocode.ATTRIBUTION
    assert tools.validate_bbox(country["search_bbox"])


def test_find_place_tool_errors(client, monkeypatch):
    import requests

    assert client.post("/api/tools/find_place", json={"query": "x"}).status_code == 400
    monkeypatch.setattr(geocode, "search", lambda q, session=None: [])
    r = client.post("/api/tools/find_place", json={"query": "Atlantis"})
    assert r.status_code == 400 and "No places match" in r.get_json()["error"]

    def down(q, session=None):
        raise requests.ConnectionError("down")
    monkeypatch.setattr(geocode, "search", down)
    r = client.post("/api/tools/find_place", json={"query": "Lake Chad"})
    assert r.status_code == 400 and "temporarily unavailable" in r.get_json()["error"]
