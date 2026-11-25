"""Release-tier facts attached to every NISAR pass (app/maturity.py)."""

from app import maturity, nisar


def test_tier_from_labels_and_collection_names():
    assert maturity.tier_of("provisional") == "provisional"
    assert maturity.tier_of("NISAR_L2_GCOV_PROVISIONAL_V1") == "provisional"
    assert maturity.tier_of("NISAR_L2_GCOV_BETA_V1") == "beta"
    # Validated short names drop the maturity word.
    assert maturity.tier_of("NISAR_L2_GCOV_V1") == "validated"
    assert maturity.tier_of("NISAR_L3_SME2_V12") == "validated"
    assert maturity.tier_of("good") == "unknown"
    assert maturity.tier_of(None) == "unknown"


def test_assess_flags_reprocessing_gap_and_urgent_response():
    early = maturity.assess("provisional", "2026-08-01T05:00:00Z")
    assert early["tier"] == "provisional"
    assert early["superseded_by_reprocessing"] and early["in_gap"]
    assert any("2027" in n for n in early["notes"])

    late = maturity.assess("validated", "2026-11-02")
    assert not late["superseded_by_reprocessing"] and not late["in_gap"]
    assert late["notes"] == [maturity.TIER_NOTES["validated"]]

    ur = maturity.assess(None, "2026-11-02", collection="NISAR_L2_GUNW_V1",
                         title="NISAR_L2_UR_GUNW_001_120_A_050_...")
    assert ur["tier"] == "validated" and ur["urgent_response"]
    assert any("30 days" in n for n in ur["notes"])


def test_sme2_is_never_validated_before_2027():
    a = maturity.assess("provisional", "2026-11-02", product="SME2")
    assert any("SME2" in n for n in a["notes"])


def test_summarize_mixed_series_across_gap():
    passes = [
        {"date": "2026-07-08", "quality": "provisional"},
        {"date": "2026-08-30", "quality": "provisional"},
        {"date": "2026-10-24", "quality": "validated"},
    ]
    s = maturity.summarize(passes)
    assert s["counts"] == {"validated": 1, "provisional": 2}
    assert s["mixed"] and s["spans_gap"] and s["superseded"] == 2
    assert len(s["notes"]) == 3


def test_summarize_clean_validated_series_has_no_notes():
    s = maturity.summarize([{"date": "2026-10-24", "quality": "validated"},
                            {"date": "2026-11-05", "quality": "validated"}])
    assert not s["mixed"] and not s["spans_gap"] and s["notes"] == []


def test_parsed_granule_carries_maturity():
    entry = {
        "id": "G1", "title": "NISAR_L2_PR_GCOV_010_120_A_050_2000_SHNA_A_20261102T000000_X",
        "dataset_id": "NISAR_L2_GCOV_V1", "time_start": "2026-11-02T00:00:00Z", "links": [],
    }
    g = nisar.parse_granule(entry, "GCOV")
    assert g["quality"] == "validated"
    assert g["maturity"]["tier"] == "validated"
    assert not g["maturity"]["superseded_by_reprocessing"]
