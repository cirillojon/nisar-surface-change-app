"""Auto stories: templated, numbers-only text built from a detector candidate.

Rules (docs/DATA_AND_METHODS.md §1 and docs/AUTOMATION.md):

* Every number in the text comes from the candidate, which the detectors
  computed from the committed passes; every date is a pass date.
* No causes, no hypotheses, no advice. An event feed record is shown as
  "Reported nearby" context with its source, never as what drove the change.
* One evolving story per watched place. A newer accepted change replaces the
  text and the old version goes into ``history``. A published story is only
  taken down by a person (``status: "retracted"`` with a reason), so it can't
  flicker as more passes change the statistics.
"""
from __future__ import annotations

from datetime import date

from app.auto import ACTIVE, STATUS_LABEL
from pipeline.detect import best

LABELS = {
    "hh_db": "median HH backscatter",
    "hv_db": "median HV backscatter",
    "water_pct": "share of the window reading as open water",
}
SHORT = {"hh_db": "HH brightness", "hv_db": "HV brightness", "water_pct": "open water"}
CHANNELS = {
    "hh_db": "HH: rough and built surfaces read bright, calm water dark.",
    "hv_db": "HV: brightens with vegetation volume and other rough, layered surfaces.",
    "water_pct": "HH: calm open water reflects the radar away, so it reads dark (below −18 dB).",
}
# What a radar-brightness change can't tell, per kind of place.
CANT_SEE_KIND = {
    "Volcano": "Whether new lava, ash, or steam made the difference: they can read alike.",
    "Earthquake": "Ground motion itself: brightness shows surface damage or disturbance, not displacement (that needs interferometry).",
    "Landslide": "The slide's outline or depth; slopes facing away from the satellite fall in radar shadow.",
    "Flood": "Water under trees or tall crops, which can read bright rather than dark.",
    "Wildfire": "Burn severity: a burn can brighten or darken radar depending on moisture and what is left standing.",
    "Glacier": "Ice speed or thickness: brightness tracks the surface (melt, crevasses, calving front), not flow.",
}
CANT_SEE = [
    "Why it changed: this story was found by a rule, not reviewed by a person.",
    "Anything between passes: passes are 12 or more days apart.",
    "Soil moisture, rain, snow and wind on water all change brightness too.",
]
NEXT = {
    "application": "Flagging change in new NISAR passes within days, anywhere on the watch list.",
    "who": "Anyone following this place; a person still has to check what the change is.",
    "needs": "Review by a person, optical images or field reports, and more passes.",
}


def fmt_day(d: str) -> str:
    x = date.fromisoformat(d)
    return f"{x.day} {x.strftime('%b')} {x.year}"


def _num(v: float, digits: int = 1) -> str:
    s = f"{abs(v):.{digits}f}".rstrip("0").rstrip(".") if digits else f"{abs(v):.0f}"
    return ("−" if v < 0 else "") + s


def _up(v: float) -> str:
    return "rose" if v > 0 else "fell"


def _patch_text(c: dict, place: dict) -> tuple[str, str, str]:
    tone = c["direction_db"]
    where = ("near the centre of the window" if c["direction"] == "centre"
             else f"about {_num(c['offset_km'])} km {c['direction']} of the window's centre")
    title = f"A {_num(c['area_km2'], 2)} km² patch turns {tone} at {place['name']}"
    summary = (
        f"Between {fmt_day(c['start'])} and {fmt_day(c['end'])} ({c['days_apart']} days apart), "
        f"{_num(c['area_km2'], 2)} km² {where} turned {tone} in HH, by {_num(abs(c['mean_change_db']))} dB on "
        f"average, after removing the {_num(c['shift_db'], 2)} dB shift of the whole window. "
        f"On {fmt_day(c['held_on'])}, {round(c['held_share'] * 100)}% of the patch still differed. "
        f"In this place's {c['pairs']} pairs of passes the largest changed patch is usually {c['usual_patch_px']} "
        f"pixels; this one is {c['patch_px']}."
    )
    channel = (f"The change map (in the Layer menu) compares HH on {fmt_day(c['start'])} and "
               f"{fmt_day(c['end'])}: pixels past 4 dB, smoothed over 5 x 5 pixels, water on both dates left out.")
    return title, summary, channel


def _step_text(c: dict, place: dict) -> tuple[str, str, str]:
    m, u = c["metric"], c["unit"]
    sp = "" if u == "%" else " "
    title = f"{SHORT[m].capitalize()} {'rises' if c['change'] > 0 else 'falls'} at {place['name']}"
    summary = (
        f"The {LABELS[m]} {_up(c['change'])} from {_num(c['before'], 2)}{sp}{u} on {fmt_day(c['start'])} to "
        f"{_num(c['after'], 2)}{sp}{u} on {fmt_day(c['end'])} ({c['days_apart']} days apart), "
        f"{_num(c['score'])} times this place's usual change between passes ({_num(c['noise'], 2)}{sp}{u}). "
        f"On {fmt_day(c['held_on'])} it read {_num(c['held_value'], 2)}{sp}{u}."
    )
    return title, summary, CHANNELS[m]


def _trend_text(c: dict, place: dict) -> tuple[str, str, str]:
    m, u = c["metric"], c["unit"]
    sp = "" if u == "%" else " "
    title = f"{SHORT[m].capitalize()} {'climbs' if c['rate_per_month'] > 0 else 'drops'} steadily at {place['name']}"
    summary = (
        f"Over {c['passes']} passes from {fmt_day(c['start'])} to {fmt_day(c['end'])}, the {LABELS[m]} "
        f"{_up(c['rate_per_month'])} at {_num(abs(c['rate_per_month']), 2)}{sp}{u} a month "
        f"(± {_num(c['se_per_month'], 2)}), from {_num(c['first_value'], 2)}{sp}{u} to "
        f"{_num(c['last_value'], 2)}{sp}{u}. A straight line explains {round(c['r2'] * 100)}% of the variation."
    )
    if c.get("mode"):
        summary += f" Only passes in the commonest acquisition mode ({c['mode']}) are used."
    return title, summary, CHANNELS[m]


TEXT = {"patch": _patch_text, "step": _step_text, "trend": _trend_text}
KEY_LIMIT = {
    "patch": "A rule found this patch of change. Brightness alone can't tell what the surface became.",
    "step": "One number over the whole window: it can't show where in the window the change happened.",
    "trend": "A straight line through a short, provisional record; it may not continue.",
}


def event_line(event: dict | None) -> str | None:
    if not event:
        return None
    return (f"Reported nearby: {event['title']} ({event['source']}, {fmt_day(event['date'])}). "
            "Shown for context; the radar record alone doesn't show what drove any change.")


def build_story(place: dict, c: dict, today: str) -> dict:
    """A full auto story for ``place`` led by candidate ``c``."""
    title, summary, channel = TEXT[c["kind"]](c, place)
    event = (place.get("watch") or {}).get("event")
    where = ", ".join(x for x in (place["name"], place.get("region")) if x)
    origin = event_line(event) or "On the NISAR Watch list of places checked every day for change."
    pair = [c["start"], c["end"]]
    return {
        "slug": place["slug"],
        "origin": "auto",
        "source": "landchange",
        "status": ACTIVE,
        "status_label": STATUS_LABEL,
        "theme": place["theme"],
        "kind": place.get("kind"),
        "title": title,
        "summary": summary,
        "question": f"What changed at {place['name']} between {fmt_day(pair[0])} and {fmt_day(pair[1])}?",
        "place": f"{where}. {origin}",
        "channel": channel,
        "key_limit": KEY_LIMIT[c["kind"]],
        "hypotheses": [],
        "cant_see": [x for x in (CANT_SEE_KIND.get(place.get("kind")),) if x] + CANT_SEE,
        "next": NEXT,
        "detector": c["kind"],
        "detection": c,
        "pair": pair,
        "period": {"start": pair[0], "end": pair[1]},
        "event": event,
        "event_date": (event or {}).get("date"),
        "detected_at": today,
        "updated_at": today,
        "history": [],
    }


def _same(a: dict, b: dict) -> bool:
    return all(a.get(k) == b.get(k) for k in ("kind", "metric", "start", "end"))


def usable(place: dict, c: dict) -> bool:
    """Event places publish only change that starts by the event and ends after it."""
    event = (place.get("watch") or {}).get("event")
    if not event:
        return True
    if c["kind"] == "trend":
        return False
    return c["start"] <= event["date"] <= c["end"]


def update(existing: dict | None, place: dict, candidates: list[dict], today: str) -> tuple[dict | None, str]:
    """The story to keep for ``place`` and what happened (``new``, ``updated``, ``unchanged``, ``none``)."""
    ok = [c for c in candidates if c["status"] == "accepted" and usable(place, c)]
    if existing and existing.get("status") != ACTIVE:
        return existing, "unchanged"  # retracted or superseded by a person: leave it
    if not ok:
        return existing, "unchanged" if existing else "none"
    lead = best(ok)
    fresh = build_story(place, lead, today)
    if existing is None:
        return fresh, "new"
    old = existing["detection"]
    if _same(old, lead):
        if old == lead and existing["title"] == fresh["title"]:
            return existing, "unchanged"
        # Same change, numbers refined (for example the usual patch size with more pairs).
        return {**fresh, "detected_at": existing["detected_at"], "history": existing.get("history", [])}, "updated"
    if lead["end"] < old["end"]:
        return existing, "unchanged"  # keep leading with the newest change
    past = {k: existing[k] for k in ("title", "summary", "pair", "detector", "detection", "updated_at")}
    return {**fresh, "detected_at": existing["detected_at"],
            "history": [past] + existing.get("history", [])}, "updated"
