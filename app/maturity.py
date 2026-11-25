"""How far along NISAR's release ladder a pass is, and what that means for anyone citing it.

ASF releases NISAR in tiers (https://nisar-docs.asf.alaska.edu/availability-overview/):

* BETA        acquisitions Oct 2025 - Jan 2026, known banding artifacts.
* PROVISIONAL acquisitions to 23 Oct 2026.
* VALIDATED   acquisitions from 21 Oct 2026 (released 6 Nov 2026).

Everything acquired before the VALIDATED start will be superseded by a 2027
reprocessing, so granule IDs cached today will change. There is a permanent
acquisition gap from 27 Jul to 10 Aug 2026. Urgent Response products use
forecast orbits, carry no ionosphere or troposphere correction and stay in the
archive for 30 days only. SME2 soil moisture has no VALIDATED release before 2027.

The frontend mirrors these rules in ``frontend/src/services/maturity.js``;
keep the two in step.
"""

from __future__ import annotations

from datetime import date

VALIDATED_FROM = date(2026, 10, 21)
GAP_START = date(2026, 7, 27)
GAP_END = date(2026, 8, 10)
REPROCESS_YEAR = 2027
UR_RETENTION_DAYS = 30
TIERS = ("validated", "provisional", "beta")
TIER_NOTES = {
    "validated": "Validated: calibrated and checked against ground truth.",
    "provisional": "Provisional: early-mission product, calibration still being refined.",
    "beta": "Beta: first-release product with known artifacts (e.g. banding).",
    "unknown": "Release tier unknown.",
}


def _day(value) -> date | None:
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def tier_of(label: str | None) -> str:
    """Normalise a quality label or a CMR collection name to a tier."""
    lowered = (label or "").lower()
    for tier in TIERS:
        if tier in lowered:
            return tier
    # Validated short names drop the maturity word: NISAR_L2_GCOV_V1.
    if lowered.startswith("nisar_") and lowered.rstrip("0123456789").endswith("_v"):
        return "validated"
    return "unknown"


def is_urgent_response(*names: str | None) -> bool:
    """Urgent Response products are tagged ``nisar_ur`` / ``_UR_`` / "urgent"."""
    for name in names:
        lowered = (name or "").lower()
        if "urgent" in lowered or "nisar_ur" in lowered or "_ur_" in lowered:
            return True
    return False


def assess(quality: str | None, acquired, *, product: str | None = None,
           collection: str | None = None, title: str | None = None) -> dict:
    """Release facts for one pass: its tier and every caveat that applies."""
    tier = tier_of(quality)
    if tier == "unknown" and collection:
        tier = tier_of(collection)
    day = _day(acquired)
    superseded = bool(day and day < VALIDATED_FROM)
    in_gap = bool(day and GAP_START <= day <= GAP_END)
    urgent = is_urgent_response(collection, title)
    notes = [TIER_NOTES[tier]]
    if superseded:
        notes.append(f"Acquired before {VALIDATED_FROM.isoformat()}: will be replaced by the "
                     f"{REPROCESS_YEAR} reprocessing, so its granule ID will change.")
    if in_gap:
        notes.append(f"Falls in the permanent acquisition gap "
                     f"{GAP_START.isoformat()} to {GAP_END.isoformat()}.")
    if urgent:
        notes.append("Urgent Response product: preliminary (forecast orbit, no atmosphere "
                     f"correction), kept in the archive for {UR_RETENTION_DAYS} days only.")
    if (product or "").upper() == "SME2" and tier != "validated":
        notes.append(f"SME2 soil moisture has no validated release before {REPROCESS_YEAR}.")
    return {
        "tier": tier,
        "superseded_by_reprocessing": superseded,
        "in_gap": in_gap,
        "urgent_response": urgent,
        "notes": notes,
    }


def summarize(passes: list[dict], product: str | None = None) -> dict:
    """Release facts for a series of ``{"date", "quality"}`` passes."""
    counts = {t: 0 for t in (*TIERS, "unknown")}
    superseded = 0
    dates = []
    for p in passes:
        a = assess(p.get("quality"), p.get("date"), product=product)
        counts[a["tier"]] += 1
        superseded += a["superseded_by_reprocessing"]
        if p.get("date"):
            dates.append(str(p["date"])[:10])
    present = [t for t, n in counts.items() if n]
    spans_gap = bool(dates) and min(dates) < GAP_START.isoformat() and max(dates) > GAP_END.isoformat()
    notes = []
    if len(present) > 1:
        notes.append("Mixed release tiers: " + ", ".join(f"{counts[t]} {t}" for t in present)
                     + ". A step between tiers can look like change.")
    if superseded:
        notes.append(f"{superseded} of {len(passes)} passes predate the validated record and will be "
                     f"replaced by the {REPROCESS_YEAR} reprocessing.")
    if spans_gap:
        notes.append(f"The record spans NISAR's acquisition gap ({GAP_START.isoformat()} to "
                     f"{GAP_END.isoformat()}): no passes exist in it.")
    if (product or "").upper() == "SME2":
        notes.append(f"SME2 soil moisture has no validated release before {REPROCESS_YEAR}.")
    return {
        "counts": {t: n for t, n in counts.items() if n},
        "mixed": len(present) > 1,
        "superseded": superseded,
        "spans_gap": spans_gap,
        "gap": [GAP_START.isoformat(), GAP_END.isoformat()],
        "notes": notes,
    }
