"""Site stories: what NISAR measured, moment by moment, beside related data.

Each curated site has one story with two parts, on one time axis:

  1. the site's headline NISAR series, split into a few **moments**:
     a date range on the record and how to summarise it (``change``,
     ``rate``, ``peak``, ``low`` or ``value``). The config holds only dates,
     short labels and the stat; every number is computed here from the
     NISAR values, so the text can't drift from the data;
  2. **related series** from public sources (``app/drivers.py``): rain,
     river flow. They're shown on the same dates, not graded or presented
     as causes.

Open water is charted over the site's shared footprint (the area every pass
imaged; ``scripts/shared_footprint.py``), and each point carries its pass's
coverage and acquisition mode so the chart can show both.

To add a story: add an entry to ``SITE_CHAINS`` with moments whose dates
are NISAR pass dates, then run ``scripts/build_driver_data.py --site
<slug>``. ``tests/test_chains.py`` checks every moment against the
committed data.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from app import drivers
from app.change_types import METRICS

# Metrics charted as a running total since the first pass.
CUMULATIVE_METRICS = {"los_mm"}
# The map layer (frontend/src/services/layers.js) that shows a metric's pixels.
METRIC_LAYER = {"water_pct": "water", "hv_db": "hv", "hh_db": "hh"}
# Days of related data shown before the first pass.
LEAD_DAYS = 30
DAYS_PER_MONTH = 30.44
FAO_CROP_CALENDAR = {
    "name": "FAO GIEWS crop calendar, India",
    "url": "https://www.fao.org/giews/countrybrief/country.jsp?code=IND",
}

SITE_CHAINS: dict[str, dict] = {
    "punjab-crop-cycles": {
        "radar_metric": "hv_db",
        "drivers": [
            {
                "id": "rain",
                "kind": "rain",
                "label": "Rain",
                "place": "Ludhiana",
                "lat": 30.9,
                "lon": 75.85,
                "season": {"label": "June–August", "start": "06-01", "end": "08-31"},
            },
        ],
        # Season labels follow FAO GIEWS's crop calendar for India.
        "season_source": FAO_CROP_CALENDAR,
        "moments": [
            {
                "id": "winter-rise",
                "title": "Nov–Mar",
                "season": "Wheat season",
                "start": "2025-11-21",
                "end": "2026-03-21",
                "stat": "change",
                "caption": "HV climbs through the winter, with a dip in late February and early March.",
            },
            {
                "id": "april-drop",
                "title": "April",
                "season": "Wheat harvest",
                "start": "2026-03-21",
                "end": "2026-04-26",
                "stat": "change",
                "caption": "The largest drop between two passes in the record.",
            },
            {
                "id": "july-water",
                "title": "Early July",
                "season": "Rice planting",
                "metric": "water_pct",
                "label": "Very dark pixels",
                "start": "2026-07-07",
                "end": "2026-07-07",
                "stat": "value",
                "caption": "Only on this pass, the one pass that imaged less of the box; every pass is measured over the part it imaged.",
                "related": "rain",
            },
            {
                "id": "monsoon-rise",
                "title": "Jul–Sep",
                "season": "Rice season",
                "start": "2026-07-19",
                "end": "2026-09-29",
                "stat": "change",
                "caption": "HV climbs to the highest values in the record.",
                "related": "rain",
            },
            {
                "id": "autumn-fall",
                "title": "Oct–Nov",
                "season": "Rice harvest",
                "start": "2026-09-29",
                "end": "2026-11-04",
                "stat": "change",
                "caption": "HV falls at every pass to the end of the record.",
            },
        ],
    },
    "mekong-delta-rice": {
        "radar_metric": "water_pct",
        "drivers": [
            {
                "id": "river",
                "kind": "river",
                "label": "Mekong flow",
                "place": "near Tan Chau",
                "lat": 10.80,
                "lon": 105.24,
            },
            {
                "id": "rain",
                "kind": "rain",
                "label": "Rain",
                "place": "An Giang",
                "lat": 10.5,
                "lon": 105.2,
            },
        ],
        "moments": [
            {
                "id": "dry-start",
                "title": "Jun–Jul",
                "start": "2026-06-19",
                "end": "2026-07-25",
                "stat": "peak",
                "caption": "Almost none of the box reads as open water.",
            },
            {
                "id": "water-spreads",
                "title": "Aug–Sep",
                "start": "2026-07-25",
                "end": "2026-09-11",
                "stat": "change",
                "caption": "Open water spreads across the box.",
            },
            {
                "id": "water-stays",
                "title": "Sep–Oct",
                "start": "2026-09-11",
                "end": "2026-10-29",
                "stat": "change",
                "caption": "Open water dips in early October and ends a little below its peak.",
            },
        ],
    },
    "sylhet-haor-floods": {
        "radar_metric": "water_pct",
        "drivers": [
            {
                "id": "rain",
                "kind": "rain",
                "label": "Rain",
                "place": "Sylhet basin",
                "lat": 24.9,
                "lon": 91.3,
            },
            {
                "id": "river",
                "kind": "river",
                "label": "Surma flow",
                "place": "at Sunamganj",
                "lat": 25.07,
                "lon": 91.40,
            },
        ],
        "moments": [
            {
                "id": "fill",
                "title": "Late Jun–mid Jul",
                "start": "2026-06-20",
                "end": "2026-07-14",
                "stat": "change",
                "caption": "Open water grows to about half of the area every pass imaged.",
                "related": "rain",
            },
            {
                "id": "drain",
                "title": "Mid Jul–Nov",
                "start": "2026-07-14",
                "end": "2026-11-11",
                "stat": "change",
                "caption": "Open water shrinks, zigzagging from pass to pass on the way down.",
                "related": "rain",
            },
            {
                "id": "mode-check",
                "title": "Mode check",
                "start": "2026-09-12",
                "end": "2026-09-24",
                "stat": "change",
                "caption": (
                    "Same ground, two radar modes. From mid-August to early October the "
                    "readings alternate high and low with the mode of each pass."
                ),
            },
        ],
    },
    "okavango-flood-pulse": {
        "radar_metric": "water_pct",
        "drivers": [
            {
                "id": "river",
                "kind": "river",
                "label": "Okavango inflow",
                "place": "at Mohembo",
                "lat": -18.28,
                "lon": 21.79,
                "lead_days": 180,
            },
            {
                "id": "rain",
                "kind": "rain",
                "label": "Rain",
                "place": "over the delta",
                "lat": -19.3,
                "lon": 22.9,
            },
        ],
        "moments": [
            {
                "id": "high",
                "title": "Early July",
                "start": "2026-07-08",
                "end": "2026-07-08",
                "stat": "value",
                "caption": "The highest open-water reading in the record.",
                "related": "river",
            },
            {
                "id": "shrink",
                "title": "Jul–Oct",
                "start": "2026-07-08",
                "end": "2026-10-24",
                "stat": "change",
                "caption": "Open water falls or holds at every pass.",
                "related": "rain",
            },
        ],
    },
    "columbia-basin-crops": {
        "radar_metric": "hv_db",
        "drivers": [
            {
                "id": "rain",
                "kind": "rain",
                "label": "Rain",
                "place": "centre of the box",
                "lat": 47.1,
                "lon": -119.55,
            },
        ],
        "moments": [
            {
                "id": "summer-rise",
                "title": "Jun–Aug",
                "start": "2026-06-19",
                "end": "2026-08-18",
                "stat": "change",
                "caption": "HV rises to the highest values in the record.",
                "related": "rain",
            },
            {
                "id": "autumn-fall",
                "title": "Late Aug–Oct",
                "start": "2026-08-18",
                "end": "2026-10-29",
                "stat": "change",
                "caption": "HV falls at every pass, and the bright circular fields darken in the images.",
                "related": "rain",
            },
            {
                "id": "dark-pixels",
                "title": "Late October",
                "metric": "water_pct",
                "label": "Very dark pixels",
                "start": "2026-10-29",
                "end": "2026-10-29",
                "stat": "value",
                "caption": "In field-shaped patches; the river is dark all season.",
            },
        ],
    },
    "mexico-city-subsidence": {
        "radar_metric": "los_mm",
        "drivers": [
            {
                "id": "rain",
                "kind": "rain",
                "label": "Rain",
                "place": "eastern Mexico City",
                "lat": 19.42,
                "lon": -99.03,
            },
        ],
        "moments": [
            {
                "id": "drier-months",
                "title": "Nov–Apr",
                "season": "Drier months",
                "start": "2025-10-30",
                "end": "2026-04-28",
                "stat": "rate",
                "caption": "Straight line through every pass from November to April.",
                "related": "rain",
            },
            {
                "id": "single-step",
                "title": "Mid April",
                "start": "2026-04-04",
                "end": "2026-04-16",
                "stat": "change",
                "caption": "The largest single step. The next pass moved part of the way back.",
            },
            {
                "id": "rainy-months",
                "title": "May–Oct",
                "season": "Rainy months",
                "start": "2026-05-10",
                "end": "2026-10-13",
                "stat": "rate",
                "caption": "Straight line through every pass from May to October.",
                "related": "rain",
            },
        ],
    },
}


def _day(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.day} {d:%b %Y}"


def _minus(text: str) -> str:
    return text.replace("-", "−")


def _amount(value: float, unit: str) -> str:
    """A reading, e.g. ``53.3%``, ``−15.7 dB``, ``−204 mm``."""
    if unit == "%":
        return _minus(f"{value:.1f}%")
    if unit == "mm":
        return _minus(f"{value:+.0f} mm")
    return _minus(f"{value:.1f} {unit}".strip())


def _difference(value: float, unit: str) -> str:
    """A signed difference; percentages change by points."""
    if unit == "%":
        return _minus(f"{value:+.1f} pts")
    if unit == "mm":
        return _minus(f"{value:+.0f} mm")
    return _minus(f"{value:+.1f} {unit}".strip())


def _short(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.day} {d:%b}"


def _span(first: float, last: float, unit: str) -> str:
    """``−18.9 → −15.7 dB``: the unit once, after the second reading."""
    number = _amount(first, unit).replace("%", "").replace(f" {unit}", "") if unit else f"{first:g}"
    return f"{number} → {_amount(last, unit)}"


def _fit(points: list[dict]) -> tuple[float, float, float]:
    """Least-squares slope per day, its standard error and the intercept."""
    t0 = date.fromisoformat(points[0]["date"])
    xs = [(date.fromisoformat(p["date"]) - t0).days for p in points]
    ys = [p["value"] for p in points]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    intercept = my - slope * mx
    residual = sum((y - (intercept + slope * x)) ** 2 for x, y in zip(xs, ys))
    error = (residual / (n - 2) / sxx) ** 0.5 if n > 2 else float("nan")
    return slope, error, intercept


def _related(cfg: dict, series: Optional[dict], start: str, end: str) -> Optional[dict]:
    """The related series over the moment: a total for rain, a mean for flow.

    A single-pass moment uses the window before that pass.
    """
    if not series:
        return None
    kind = drivers.KINDS[cfg["kind"]]
    last = date.fromisoformat(end)
    if start == end:
        value = drivers.before_pass(series, last, kind["aggregate"])
        span = f"{drivers.WINDOW_DAYS} days to the pass"
    else:
        first = date.fromisoformat(start)
        values = drivers._window(series, first, last)
        value = None if values is None else (
            sum(values) if kind["aggregate"] == "sum" else sum(values) / len(values)
        )
        span = "total" if kind["aggregate"] == "sum" else "average"
    if value is None:
        return None
    return {
        "id": cfg["id"],
        "label": cfg["label"],
        "value": round(value, 1),
        "display": f"{value:,.0f} {kind['unit']}",
        "span": span,
    }


def _moment(cfg: dict, series: list[dict], unit: str, related: Optional[dict]) -> dict:
    by_date = {p["date"]: p for p in series}
    start, end = cfg["start"], cfg["end"]
    if start not in by_date or end not in by_date:
        raise ValueError(f"moment {cfg['id']}: {start} and {end} must be NISAR pass dates")
    inside = [p for p in series if start <= p["date"] <= end]
    stat = cfg["stat"]
    out = {
        "id": cfg["id"],
        "title": cfg["title"],
        "season": cfg.get("season"),
        "caption": cfg["caption"],
        "start": start,
        "end": end,
        "focus": end,
        "metric": cfg.get("metric"),
        "unit": unit,
        "stat": stat,
        "passes": len(inside),
        "related": related,
    }
    first, last = by_date[start]["value"], by_date[end]["value"]
    if stat == "change":
        value = last - first
        detail = _span(first, last, unit)
        if len(inside) == 2:
            days = (date.fromisoformat(end) - date.fromisoformat(start)).days
            detail += f" · {days} days apart"
        out.update(
            display=_difference(value, unit), detail=detail,
            readings=[{"date": d, "display": _amount(v, unit)} for d, v in ((start, first), (end, last))],
        )
    elif stat == "rate":
        slope, error, intercept = _fit(inside)
        value = slope * DAYS_PER_MONTH
        days = (date.fromisoformat(end) - date.fromisoformat(start)).days
        out.update(
            display=_minus(f"{value:+.1f} {unit}/month"),
            detail=f"±{error * DAYS_PER_MONTH:.1f} · {len(inside)} passes",
            uncertainty=round(error * DAYS_PER_MONTH, 2),
            fit={"start": round(intercept, 2), "end": round(intercept + slope * days, 2)},
        )
    elif stat in ("peak", "low"):
        pick = max if stat == "peak" else min
        point = pick(inside, key=lambda p: p["value"])
        value = point["value"]
        word = "Highest" if stat == "peak" else "Lowest"
        out.update(focus=point["date"], display=_amount(value, unit),
                   detail=f"{word} of {len(inside)} passes, {_short(point['date'])}")
    elif stat == "value":
        value = last
        out.update(display=_amount(value, unit), detail=_day(end))
    else:
        raise ValueError(f"moment {cfg['id']}: unknown stat {stat!r}")
    if cfg.get("label"):
        out["detail"] = f"{cfg['label']}, {out['detail']}"
    out["value"] = round(value, 2)
    return out


def _radar_summary(series: list[dict], metric: str, unit: str) -> str:
    latest = series[-1]
    if metric in CUMULATIVE_METRICS:
        months = (date.fromisoformat(latest["date"]) - date.fromisoformat(series[0]["date"])).days
        return f"{_amount(latest['value'], unit)} in {months / DAYS_PER_MONTH:.0f} months"
    low = min(series, key=lambda p: p["value"])
    high = max(series, key=lambda p: p["value"])
    return f"{_amount(low['value'], unit)} to {_amount(high['value'], unit)}"


def _driver_summary(kind: str, series: dict, first_pass: str, last_pass: str) -> str:
    season = series.get("season")
    if season and season.get("pct_of_normal") is not None:
        return f"{season['label']} rain {season['pct_of_normal']}% of normal"
    start, end = date.fromisoformat(first_pass), date.fromisoformat(last_pass)
    daily = drivers.points(series)
    if not daily:
        return ""
    if kind == "rain":
        amount = drivers.total(series, start, end)
        return "" if amount is None else f"{amount:,.0f} mm over the radar record"
    if kind == "river":
        # The whole charted series: the peak may come before the first pass.
        peak = max(daily, key=lambda p: p["value"])
        return f"Peak {peak['value']:,.0f} m³/s on {_day(peak['date'])}"
    count = sum(p["value"] for p in daily if first_pass <= p["date"] <= last_pass)
    return f"{count:.0f} located over the radar record"


def _season_note(season: Optional[dict]) -> str:
    """Where a "% of normal" comes from: its own reanalysis, not the daily bars."""
    if not season:
        return ""
    text = (
        f" Normal is the {season['baseline']} {season['source']} mean for "
        f"{season['label']}: {season['total']:.0f} mm this year against "
        f"{season['normal']:.0f} mm"
    )
    if season["rank"] == 1:
        text += f", the driest of {season['years']} years"
    return text + "."


def _driver(cfg: dict, series: dict, passes: list[str]) -> dict:
    kind = drivers.KINDS[cfg["kind"]]
    per_pass = []
    for day in passes:
        value = drivers.before_pass(series, date.fromisoformat(day), kind["aggregate"])
        if value is not None:
            per_pass.append({"date": day, "value": value})
    return {
        "id": cfg["id"],
        "kind": cfg["kind"],
        "label": cfg["label"],
        "place": cfg.get("place"),
        "unit": kind["unit"],
        "chart": kind["chart"],
        "aggregate": kind["aggregate"],
        "source": kind["source"],
        "note": kind["note"] + _season_note(series.get("season")),
        "series": drivers.points(series),
        "per_pass": per_pass,
        "summary": _driver_summary(cfg["kind"], series, passes[0], passes[-1]),
    }


def _passes(site_dict: dict) -> dict[str, dict]:
    """Per-pass coverage, quality and acquisition mode, by date."""
    return {
        scene["date"]: {
            "coverage": scene.get("valid_pct"),
            "quality": scene.get("quality"),
            "mode": scene.get("mode"),
        }
        for scene in site_dict.get("scenes") or []
    }


def _series_of(site_dict: dict, metric: str) -> list[dict]:
    """``[{date, value}]`` of one metric, in date order."""
    by_date = {
        o["observed_on"]: round(float(o["value"]), 2)
        for o in site_dict.get("observations") or []
        if o["metric"] == metric
    }
    return [{"date": d, "value": by_date[d]} for d in sorted(by_date)]


def story_metric(slug: str) -> Optional[str]:
    """The metric a site's story charts, so other views can skip repeating it."""
    return SITE_CHAINS.get(slug, {}).get("radar_metric")


def get_site_chain(site_dict: dict, *, snapshot: Optional[dict] = None) -> dict:
    """The story for a serialized detail site (``Site.to_dict(detail=True)``)."""
    slug = site_dict.get("slug")
    cfg = SITE_CHAINS.get(slug)
    empty = {"site_slug": slug, "available": False}
    if not cfg:
        return empty

    metric = cfg["radar_metric"]
    series = _series_of(site_dict, metric)
    footprint = site_dict.get("footprint")
    if len(series) < 2:
        if metric == "water_pct" and footprint and footprint.get("status") == "insufficient":
            return {**empty, "reason": (
                f"The passes share only {footprint['pct_of_box']}% of the box, under the "
                f"{footprint['min_pct']}% needed to compare open water between them."
            )}
        return empty

    unit = METRICS[metric]["unit"]
    passes = [row["date"] for row in series]
    scenes = _passes(site_dict)
    series_by_id = (drivers.snapshot() if snapshot is None else snapshot).get(slug, {})
    driver_cfgs = {d["id"]: d for d in cfg["drivers"]}

    moments = []
    for moment in cfg["moments"]:
        moment_metric = moment.get("metric", metric)
        points = series if moment_metric == metric else _series_of(site_dict, moment_metric)
        related_id = moment.get("related")
        related = related_id and _related(
            driver_cfgs[related_id], series_by_id.get(related_id), moment["start"], moment["end"],
        )
        built = _moment(moment, points, METRICS[moment_metric]["unit"], related or None)
        built["layer"] = METRIC_LAYER.get(moment_metric)
        moments.append(built)

    uses_footprint = "water_pct" in {metric, *(m.get("metric") for m in cfg["moments"])}
    return {
        "site_slug": slug,
        "available": True,
        "window_days": drivers.WINDOW_DAYS,
        "radar": {
            "metric": metric,
            "label": METRICS[metric]["label"],
            "unit": unit,
            "product": site_dict.get("product"),
            "cumulative": metric in CUMULATIVE_METRICS,
            "layer": METRIC_LAYER.get(metric),
            "points": [{**point, **scenes.get(point["date"], {})} for point in series],
            "summary": _radar_summary(series, metric, unit),
        },
        "footprint": footprint if uses_footprint else None,
        "moments": moments,
        "season_source": cfg.get("season_source"),
        "drivers": [
            _driver(d, series_by_id[d["id"]], passes)
            for d in cfg["drivers"]
            if d["id"] in series_by_id
        ],
    }


def get_area_context(bbox, start: date, end: date, *, session=None) -> dict:
    """Rain at the centre of a drawn area over the searched dates."""
    series = drivers.area_rain(bbox, start, end, session=session)
    kind = drivers.KINDS["rain"]
    daily = drivers.points(series)
    amount = sum(p["value"] for p in daily)
    return {
        "window_days": drivers.WINDOW_DAYS,
        "drivers": [{
            "id": "rain",
            "kind": "rain",
            "label": kind["label"],
            "place": "at the centre of the area",
            "unit": kind["unit"],
            "chart": kind["chart"],
            "aggregate": kind["aggregate"],
            "source": kind["source"],
            "note": kind["note"],
            "series": daily,
            "summary": f"{amount:,.0f} mm over the searched dates" if daily else "",
        }],
    }
