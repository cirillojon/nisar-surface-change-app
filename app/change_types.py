"""Surface-change categories and the NISAR-derived metrics they chart.

Each change type says which NISAR product its sites are computed from
(``scripts/extract_nisar.py``), which metrics the site panel charts (first
is the headline), how to read its images, and how the change looks to an
L-band radar. The API and UI pick up new entries automatically.
"""

METRICS = {
    "hh_db": {
        "label": "HH backscatter",
        "unit": "dB",
        "description": "Median HH brightness over the box. Responds to soil, stems "
                       "and flooded vegetation.",
    },
    "hv_db": {
        "label": "HV backscatter",
        "unit": "dB",
        "description": "Median HV brightness over the box. Rises with vegetation.",
    },
    "water_pct": {
        "label": "Open water",
        "unit": "%",
        "description": "Share of the area every pass imaged (the shared footprint) with HH "
                       "below -18 dB, so passes are compared over the same ground. Misses "
                       "wind-roughened water and flooded vegetation; can include smooth bare ground.",
    },
    # Provenance only (not charted): the share of the pixels that pass imaged.
    "water_visible_pct": {
        "label": "Open water, pixels this pass imaged",
        "unit": "%",
        "description": "Share of the pixels this pass imaged with HH below -18 dB. Not "
                       "comparable between passes that imaged different parts of the box.",
    },
    "los_mm": {
        "label": "Line-of-sight displacement",
        "unit": "mm",
        "description": "Cumulative motion relative to the reference point; + toward "
                       "the satellite, - away.",
    },
    "coherence": {
        "label": "Coherence",
        "unit": "",
        "description": "Phase similarity between the two passes, 0-1. Low means a "
                       "less reliable step.",
    },
}

GCOV_IMAGE = (
    "Red = HH, green = HV, blue = HH/HV. Purple-blue: smooth ground; "
    "green-yellow: vegetation and buildings; dark: calm water."
)
GUNW_IMAGE = "Motion since the first date: red = away from the satellite, blue = toward."

CHANGE_TYPES = {
    "agriculture": {
        "label": "Crops & farming",
        "color": "#84cc16",
        "product": "GCOV",
        "metrics": ["hv_db", "hh_db", "water_pct"],
        "image_legend": GCOV_IMAGE,
        "radar_signature": "HV rises as crops grow and drops at harvest. Flooded paddies look dark.",
    },
    "flood_wetland": {
        "label": "Floods & wetlands",
        "color": "#38bdf8",
        "product": "GCOV",
        "metrics": ["water_pct", "hh_db", "hv_db"],
        "image_legend": GCOV_IMAGE,
        "radar_signature": "Calm water looks dark. Flooded vegetation looks very bright in HH.",
    },
    "subsidence": {
        "label": "Land subsidence",
        "color": "#a855f7",
        "product": "GUNW",
        "metrics": ["los_mm"],
        "image_legend": GUNW_IMAGE,
        "radar_signature": "InSAR compares the phase of passes 12 days apart; summed, the pairs show slow sinking.",
    },
    "deformation": {
        "label": "Volcanoes & earthquakes",
        "color": "#ef4444",
        "product": "GUNW",
        "metrics": ["los_mm"],
        "image_legend": GUNW_IMAGE,
        "radar_signature": "InSAR measures mm to cm of motion toward or away from the satellite.",
    },
}


def change_type_list():
    return [
        {
            "id": key,
            **meta,
            "metrics": [{"id": m, **METRICS[m]} for m in meta["metrics"]],
        }
        for key, meta in CHANGE_TYPES.items()
    ]
