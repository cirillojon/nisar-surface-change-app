import pytest
import requests

from app import nisar

# Trimmed copy of a real CMR granules.json entry.
_ENTRY = {
    "id": "G4410457284-ASF",
    "title": "NISAR_L2_PR_GCOV_035_098_A_010_0005_NASV_M_20261111T233557_20261111T233632_P05036_N_F_J_001",
    "dataset_id": "NISAR Validated Geocoded Polarimetric Covariance Product (Version 1)",
    "time_start": "2026-11-11T23:35:57.000Z",
    "time_end": "2026-11-11T23:36:32.999Z",
    "granule_size": "258.623140335083",
    "polygons": [["15.98556 89.83626 18.12678 89.29298 17.57672 87.02351 15.44546 87.58998 15.98556 89.83626"]],
    "links": [
        {"rel": "http://esipfed.org/ns/fedsearch/1.1/data#", "href": "https://nisar.asf.earthdatacloud.nasa.gov/NISAR/x/x.h5"},
        {"rel": "http://esipfed.org/ns/fedsearch/1.1/s3#", "href": "s3://bucket/x.h5"},
        {"rel": "http://esipfed.org/ns/fedsearch/1.1/browse#", "href": "https://nisar.asf.earthdatacloud.nasa.gov/BROWSE/x/x_LATLON.png"},
        {"rel": "http://esipfed.org/ns/fedsearch/1.1/browse#", "href": "https://nisar.asf.earthdatacloud.nasa.gov/BROWSE/x/x_LATLON_thumbnail.png"},
        {"rel": "http://esipfed.org/ns/fedsearch/1.1/metadata#", "href": "https://nisar.asf.earthdatacloud.nasa.gov/NISAR/x/x.h5.iso.xml"},
        {"rel": "http://esipfed.org/ns/fedsearch/1.1/metadata#", "href": "https://nisar.asf.earthdatacloud.nasa.gov/BROWSE/x/x_LATLON.kml"},
    ],
}

_KML_URL = "https://nisar.asf.earthdatacloud.nasa.gov/BROWSE/x/x_LATLON.kml"
# Shape of a real NISAR browse KML.
_KML = """<kml xmlns:ns0="http://www.google.com/kml/ext/2.2"><Document><GroundOverlay>
<Icon><href>x_LATLON.png</href></Icon>
<ns0:LatLonQuad><coordinates>86.77,15.28 90.01,15.28 90.01,18.33 86.77,18.33</coordinates></ns0:LatLonQuad>
</GroundOverlay></Document></kml>"""


class _FakeResponse:
    def __init__(self, body, hits="1"):
        self._body = body
        self.headers = {"CMR-Hits": hits}

    def raise_for_status(self):
        pass

    def json(self):
        return self._body


class _Denied(_FakeResponse):
    """Provisional granules' KML needs Earthdata Login (HTTP 401)."""

    text = "HTTP Basic: Access denied."

    def raise_for_status(self):
        raise requests.HTTPError("401")


@pytest.fixture()
def fake_cmr(monkeypatch):
    calls = []

    def _get(url, params=None, headers=None, timeout=None):
        calls.append(params)
        return _FakeResponse({"feed": {"entry": [_ENTRY]}}, hits="42")

    monkeypatch.setattr(nisar.requests, "get", _get)
    return calls


def test_parse_granule():
    g = nisar.parse_granule(_ENTRY, "GCOV")
    assert g["quality"] == "validated"
    assert g["size_mb"] == 258.6
    assert g["data_url"].endswith(".h5")
    assert g["browse_url"].endswith("_LATLON.png")
    assert g["thumbnail_url"].endswith("_thumbnail.png")
    assert g["browse_kml_url"] == _KML_URL
    assert g["footprint"][0] == [15.98556, 89.83626]
    assert g["bbox"] == [87.02351, 15.44546, 89.83626, 18.12678]
    assert (g["cycle"], g["track"], g["orbit_direction"], g["frame"]) == ("035", "098", "A", "010")
    assert g["processing_variant"] == "PR"
    assert g["urgent_response"] is False


def test_parse_granule_tolerates_missing_fields():
    g = nisar.parse_granule({"id": "G1"}, "GUNW")
    assert g["footprint"] is None and g["bbox"] is None and g["data_url"] is None
    assert g["urgent_response"] is None


def test_urgent_response_metadata_is_parsed_and_mixed_gslc_pair_is_rejected():
    urgent = nisar.parse_granule(
        {"title": "NISAR_L2_UR_GSLC_035_098_A_010_0005_TEST"},
        "GSLC",
    )
    standard = nisar.parse_granule(
        {"title": "NISAR_L2_PR_GSLC_035_098_A_010_0005_TEST"},
        "GSLC",
    )
    assert urgent["urgent_response"] is True
    assert urgent["processing_variant"] == "UR"
    with pytest.raises(nisar.NisarPairingError, match="urgent-response and standard"):
        nisar.require_gslc_pair_compatible(urgent, standard)


def test_gslc_pair_guard_requires_matching_provenance_and_verified_alignment():
    first = {
        "product": "GSLC", "urgent_response": False,
        "track": "098", "orbit_direction": "A", "frame": "010",
    }
    second = dict(first)
    with pytest.raises(nisar.NisarPairingError, match="orbit provenance"):
        nisar.require_gslc_pair_compatible(first, second)
    with pytest.raises(nisar.NisarPairingError, match="alignment"):
        nisar.require_gslc_pair_compatible(
            first, second, orbit_type=("medium-precision", "medium-precision"),
            ionosphere_correction=("applied", "applied"),
        )
    mismatched_track = {**second, "track": "099"}
    with pytest.raises(nisar.NisarPairingError, match="track"):
        nisar.require_gslc_pair_compatible(
            first, mismatched_track, orbit_type=("medium-precision", "medium-precision"),
            ionosphere_correction=("applied", "applied"), alignment_verified=True,
        )
    nisar.require_gslc_pair_compatible(
        first, second, orbit_type=("medium-precision", "medium-precision"),
        ionosphere_correction=("applied", "applied"), alignment_verified=True,
    )


def test_products_listed(client):
    r = client.get("/api/nisar/products")
    assert r.status_code == 200
    assert "GCOV" in {p["id"] for p in r.get_json()["products"]}


def test_granule_search(client, fake_cmr):
    r = client.get(
        "/api/nisar/granules?bbox=87,15,90,18&product=GCOV&start=2026-10-01&end=2026-11-12&limit=5"
    )
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["hits"] == 42
    assert body["granules"][0]["id"] == "G4410457284-ASF"
    params = fake_cmr[0]
    assert params["bounding_box"] == "87.0,15.0,90.0,18.0"
    assert params["short_name[]"] == nisar.PRODUCTS["GCOV"]["collections"]
    assert params["temporal"] == "2026-10-01T00:00:00Z,2026-11-12T23:59:59Z"
    assert params["page_size"] == 5


def test_granule_search_is_cached(client, fake_cmr):
    url = "/api/nisar/granules?bbox=87,15,90,18&start=2026-10-01&end=2026-11-12"
    client.get(url)
    client.get(url)
    assert len(fake_cmr) == 1


@pytest.mark.parametrize("query", [
    "",
    "bbox=1,2,3",
    "bbox=10,10,5,20",
    "bbox=0,0,1,1&product=XYZ",
    "bbox=0,0,1,1&start=2026-05-01&end=2026-04-01",
    "bbox=0,0,1,1&limit=lots",
])
def test_granule_search_validation(client, fake_cmr, query):
    r = client.get(f"/api/nisar/granules?{query}")
    assert r.status_code == 400
    assert "error" in r.get_json()
    assert fake_cmr == []


def test_granule_search_upstream_failure(client, monkeypatch):
    def _boom(*_a, **_k):
        raise requests.ConnectionError("down")

    monkeypatch.setattr(nisar.requests, "get", _boom)
    r = client.get("/api/nisar/granules?bbox=0,0,1,1")
    assert r.status_code == 502
    assert "error" in r.get_json()


def test_browse_bounds_from_kml(client, monkeypatch):
    calls = []

    def _get(url, **_kwargs):
        calls.append(url)
        resp = _FakeResponse({})
        resp.text = _KML
        return resp

    monkeypatch.setattr(nisar.requests, "get", _get)
    for _ in range(2):
        r = client.get("/api/nisar/browse-bounds", query_string={"kml": _KML_URL})
        assert r.status_code == 200, r.get_json()
        assert r.get_json()["bbox"] == [86.77, 15.28, 90.01, 18.33]
    assert calls == [_KML_URL]


@pytest.mark.parametrize("url", [
    "",
    "https://evil.example/BROWSE/x_LATLON.kml",
    "http://nisar.asf.earthdatacloud.nasa.gov/BROWSE/x_LATLON.kml",
    "https://nisar.asf.earthdatacloud.nasa.gov/NISAR/x.h5",
    "https://nisar.asf.earthdatacloud.nasa.gov@evil.example/x_LATLON.kml",
])
def test_browse_bounds_only_fetches_nisar_kml(client, monkeypatch, url):
    def _never(*_a, **_k):
        raise AssertionError("must not fetch")

    monkeypatch.setattr(nisar.requests, "get", _never)
    r = client.get("/api/nisar/browse-bounds", query_string={"kml": url})
    assert r.status_code == 400


def test_browse_bounds_unavailable(client, monkeypatch):
    monkeypatch.setattr(nisar.requests, "get", lambda *_a, **_k: _Denied({}))
    r = client.get("/api/nisar/browse-bounds", query_string={"kml": _KML_URL})
    assert r.status_code == 502
    assert "error" in r.get_json()


def test_browse_bounds_fall_back_to_validated_granule_on_same_frame(client, monkeypatch):
    base = "https://nisar.asf.earthdatacloud.nasa.gov/BROWSE"
    name = "NISAR_L2_PR_GCOV_{}_043_A_022_2005_DHDH_A_X_LATLON.kml"
    provisional = f"{base}/NISAR_L2_GCOV_PROVISIONAL_V1/{name.format('033')}"
    validated = f"{base}/NISAR_L2_GCOV_V1/{name.format('034')}"
    calls = []

    def _get(url, params=None, **_kwargs):
        calls.append((url, params))
        if url == nisar.CMR_GRANULES_URL:
            link = {"rel": "http://esipfed.org/ns/fedsearch/1.1/metadata#", "href": validated}
            return _FakeResponse({"feed": {"entry": [{"id": "G1", "links": [link]}]}})
        if url != validated:
            return _Denied({})
        resp = _FakeResponse({})
        resp.text = _KML
        return resp

    monkeypatch.setattr(nisar.requests, "get", _get)
    r = client.get("/api/nisar/browse-bounds", query_string={"kml": provisional})
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["bbox"] == [86.77, 15.28, 90.01, 18.33]
    assert [url for url, _ in calls] == [provisional, nisar.CMR_GRANULES_URL, validated]
    assert calls[1][1]["readable_granule_name[]"] == "NISAR_L2_PR_????_???_043_A_022_*"

    # Another pass over the same frame reuses the cached bounds.
    older = f"{base}/NISAR_L2_GCOV_PROVISIONAL_V1/{name.format('032')}"
    r = client.get("/api/nisar/browse-bounds", query_string={"kml": older})
    assert r.get_json()["bbox"] == [86.77, 15.28, 90.01, 18.33]
    assert len(calls) == 3


def test_coverage_counts_granules_per_product(client, monkeypatch):
    from app import nisar

    calls = []

    def fake_search(bbox, start, end, product="GCOV", limit=20):
        calls.append((product, limit))
        if product == "SME2":
            raise nisar.NisarSearchError("down")
        return {"product": product, "hits": {"GCOV": 15, "GUNW": 0}.get(product, 0), "granules": []}

    monkeypatch.setattr(nisar, "search_granules", fake_search)
    body = client.get("/api/nisar/coverage?bbox=-155.3,19.4,-155.2,19.5&start=2026-08-01&end=2026-11-01").get_json()

    assert body["products"] == {"GCOV": 15, "GUNW": 0, "GOFF": 0, "GSLC": 0, "SME2": None}
    assert {limit for _, limit in calls} == {1}
    assert client.get("/api/nisar/coverage").status_code == 400
