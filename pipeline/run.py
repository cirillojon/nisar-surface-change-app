"""``python -m pipeline``: the NISAR Watch job.

    python -m pipeline run      # targets → ingest new passes → detect → publish
    python -m pipeline detect   # re-run detection and publishing on committed passes (no network)
    python -m pipeline targets  # list what would be watched (polls the event feeds)
    python -m pipeline check-token  # is EARTHDATA_TOKEN set, and how long until it expires?

``run`` options: ``--target SLUG`` (repeatable), ``--dry-run`` (search only,
write nothing), ``--max-passes N`` (whole run), ``--max-per-target N``,
``--no-events``, ``--workers N``, ``--today YYYY-MM-DD``.

It writes ``app/data/auto/{places,stories,state}.json`` and images under
``app/data/scenes/auto/``, and a Markdown summary to stdout and to
``$GITHUB_STEP_SUMMARY`` when set. See docs/AUTOMATION.md.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

from app import auto
from pipeline import detect, feeds, ingest, publish, targets
from pipeline.render import load_hh_layer

log = logging.getLogger("pipeline")

STATE_PATH = auto.AUTO_DIR / "state.json"
NOTES = {
    "places": "Written by the NISAR Watch job (python -m pipeline); see docs/AUTOMATION.md. "
              "Regenerate rather than edit.",
    "stories": "Written by the NISAR Watch job (python -m pipeline); see docs/AUTOMATION.md. "
               "Regenerate rather than edit, except to retract a story (status: retracted, retracted_reason).",
    "state": "NISAR Watch cursor: granules processed per target, and event targets. Written by python -m pipeline.",
}
MAX_PASSES = 150


def _read(path: Path, default: dict) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else default


def _write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


class Store:
    """The three auto files, read once and written back together."""

    def __init__(self, places_path=auto.PLACES_PATH, stories_path=auto.STORIES_PATH, state_path=STATE_PATH,
                 scenes_dir=ingest.SCENES_DIR):
        self.paths = {"places": Path(places_path), "stories": Path(stories_path), "state": Path(state_path)}
        self.scenes_dir = Path(scenes_dir)
        self.places = {p["slug"]: p for p in _read(self.paths["places"], {}).get("sites", [])}
        self.stories = {s["slug"]: s for s in _read(self.paths["stories"], {}).get("stories", [])}
        state = _read(self.paths["state"], {})
        self.state = {"targets": state.get("targets") or {}, "events": state.get("events") or []}

    def save(self) -> None:
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        _write(self.paths["places"], {"_note": NOTES["places"], "generated_at": now,
                                      "sites": [self.places[k] for k in sorted(self.places)]})
        _write(self.paths["stories"], {"_note": NOTES["stories"], "generated_at": now,
                                       "stories": [self.stories[k] for k in sorted(self.stories)]})
        _write(self.paths["state"], {"_note": NOTES["state"], **self.state})

    def layers(self, place: dict) -> list:
        out = []
        for p in place.get("passes") or []:
            f = self.scenes_dir / p["hh"]
            if f.is_file():
                out.append((p["date"], load_hh_layer(f)))
        return out


def detect_and_publish(store: Store, slugs, today: str) -> dict:
    """Run the detectors on each place and create or update its story."""
    report = {}
    for slug in slugs:
        place = store.places.get(slug)
        if not place:
            continue
        candidates = detect.detect_place(place, store.layers(place))
        story, action = publish.update(store.stories.get(slug), place, candidates, today)
        if story is not None:
            store.stories[slug] = story
        store.state["targets"].setdefault(slug, {})["candidates"] = [
            {k: c.get(k) for k in ("kind", "metric", "start", "end", "status", "reason", "score")}
            for c in candidates]
        report[slug] = {"candidates": candidates, "action": action,
                        "title": story["title"] if story and action in ("new", "updated") else None}
    return report


def all_targets(store: Store, today: date, *, events: bool) -> tuple[list[dict], list[dict], list[str]]:
    watch = targets.load_watchlist()
    skipped, errors = [], []
    if events:
        got, errors = feeds.fetch_events(today=today)
        store.state["events"], skipped = targets.merge_events(watch, store.state["events"], got, today)
    else:
        store.state["events"] = [t for t in store.state["events"] if t.get("expires", "9999") >= today.isoformat()]
    return watch + store.state["events"], skipped, errors


def summary(today: str, ingested: dict, detected: dict, skipped_events: list, feed_errors: list,
            pruned: list, dry_run: bool) -> str:
    lines = [f"## NISAR Watch: {today}{' (dry run)' if dry_run else ''}", ""]
    new = [s for s, r in detected.items() if r["action"] == "new"]
    upd = [s for s, r in detected.items() if r["action"] == "updated"]
    rendered = sum(len(r.get("rendered", [])) for r in ingested.values())
    lines.append(f"**{len(ingested)}** targets checked, **{rendered}** new passes, "
                 f"**{len(new)}** new stories, **{len(upd)}** updated.")
    lines += ["", "| target | frame | passes on frame | new | skipped | accepted / pending / rejected | story |",
              "|---|---|---|---|---|---|---|"]
    for slug, r in ingested.items():
        d = detected.get(slug, {})
        cs = d.get("candidates") or []
        counts = " / ".join(str(sum(c["status"] == k for c in cs)) for k in ("accepted", "pending", "rejected"))
        story = f"{d['action']}: {d['title']}" if d.get("title") else d.get("action", "")
        if r.get("error"):
            lines.append(f"| {slug} | | | | | | ⚠️ {r['error']} |")
            continue
        lines.append(f"| {slug} | {r.get('frame') or '-'} | {r.get('on_frame', 0)} | "
                     f"{r.get('planned', 0) if dry_run else len(r.get('rendered', []))} | "
                     f"{len(r.get('skipped', []))} | {counts} | {story} |")
    pend = [(s, c) for s, d in detected.items() for c in d["candidates"] if c["status"] == "pending"]
    if pend:
        lines += ["", "**Waiting for the next pass:**"]
        lines += [f"- {s}: {c['kind']} {c['metric']} {c['start']} → {c['end']} (score {c['score']})" for s, c in pend]
    rej = [(s, c) for s, d in detected.items() for c in d["candidates"] if c["status"] == "rejected"]
    if rej:
        lines += ["", "<details><summary>Rejected candidates</summary>", ""]
        lines += [f"- {s}: {c['kind']} {c['metric']} {c['start']} → {c['end']}: {c['reason']} (score {c['score']})"
                  for s, c in rej]
        lines += ["", "</details>"]
    if skipped_events:
        lines += ["", "<details><summary>Events not watched</summary>", ""]
        lines += [f"- {e['event']}: {e['why']}" for e in skipped_events[:50]]
        lines += ["", "</details>"]
    if feed_errors:
        lines += ["", "**Feed errors:** " + "; ".join(feed_errors)]
    if pruned:
        lines += ["", "**Expired event places removed:** " + ", ".join(pruned)]
    return "\n".join(lines) + "\n"


def _emit(text: str) -> None:
    print(text)
    out = os.getenv("GITHUB_STEP_SUMMARY")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(text)


def cmd_run(args, store: Store | None = None, *, search=None, render=None) -> int:
    store = store or Store()
    today = date.fromisoformat(args.today) if args.today else datetime.now(timezone.utc).date()
    all_t, skipped_events, feed_errors = all_targets(store, today, events=not args.no_events)
    chosen = [t for t in all_t if not args.target or t["slug"] in args.target]
    if args.target and not chosen:
        print(f"No target {args.target}; see `python -m pipeline targets`.", file=sys.stderr)
        return 2
    kwargs = {"search": search} | ({"render": render} if render else {})
    ingested = ingest.ingest(chosen, store.state, store.places, max_total=args.max_passes,
                             max_per_target=args.max_per_target, workers=args.workers,
                             dry_run=args.dry_run, scenes_dir=store.scenes_dir, **kwargs)
    changed = [s for s, r in ingested.items() if r.get("rendered")]
    detected = {} if args.dry_run else detect_and_publish(store, changed, today.isoformat())
    pruned = []
    if not args.dry_run and not args.target:
        alive = {t["slug"] for t in all_t} | set(store.stories)
        pruned = ingest.prune(store.places, store.state, alive, store.scenes_dir)
    if not args.dry_run:
        store.save()
    _emit(summary(today.isoformat(), ingested, detected, skipped_events, feed_errors, pruned, args.dry_run))
    failed = [s for s, r in ingested.items() if r.get("error")]
    return 1 if ingested and len(failed) == len(ingested) else 0


def cmd_detect(args, store: Store | None = None) -> int:
    store = store or Store()
    today = args.today or datetime.now(timezone.utc).date().isoformat()
    slugs = [s for s in store.places if not args.target or s in args.target]
    detected = detect_and_publish(store, slugs, today)
    store.save()
    ingested = {s: {"frame": store.places[s].get("frame"), "on_frame": len(store.places[s]["passes"])} for s in slugs}
    _emit(summary(today, ingested, detected, [], [], [], False))
    return 0


def cmd_targets(args) -> int:
    store = Store()
    today = date.fromisoformat(args.today) if args.today else datetime.now(timezone.utc).date()
    all_t, skipped, errors = all_targets(store, today, events=not args.no_events)
    for t in all_t:
        extra = f"  [{t['event']['source']}: {t['event']['title']}, expires {t['expires']}]" if t.get("event") else ""
        print(f"{t['slug']:<40} {t['kind']:<11} {t['lat']:8.3f} {t['lon']:9.3f} ±{t['half_km']} km{extra}")
    for e in errors:
        print(f"feed error: {e}", file=sys.stderr)
    return 0


TOKEN_WARN_DAYS = 10


def token_days_left(token: str, now: float | None = None) -> float | None:
    """Days until an Earthdata token (a JWT) expires, or None if it can't be read."""
    import base64
    import time

    try:
        part = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        return (float(claims["exp"]) - (now if now is not None else time.time())) / 86400
    except (IndexError, ValueError, KeyError, TypeError):
        return None


def cmd_check_token(args) -> int:
    """GitHub annotations: an error when the token is missing or expired, a warning near expiry."""
    token = os.getenv("EARTHDATA_TOKEN", "").strip()
    if not token:
        print("::error::EARTHDATA_TOKEN is not set (docs/AUTOMATION.md, Setup).")
        return 1
    days = token_days_left(token)
    if days is None:
        print("::warning::EARTHDATA_TOKEN isn't a readable JWT; can't check when it expires.")
    elif days <= 0:
        print("::error::EARTHDATA_TOKEN has expired. Make a new one at urs.earthdata.nasa.gov and update the secret.")
        return 1
    elif days < TOKEN_WARN_DAYS:
        print(f"::warning::EARTHDATA_TOKEN expires in {days:.0f} days. Make a new one at urs.earthdata.nasa.gov.")
    else:
        print(f"EARTHDATA_TOKEN valid for {days:.0f} more days.")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m pipeline", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("run", "detect", "targets"):
        p = sub.add_parser(name)
        p.add_argument("--target", action="append", help="Only this target slug (repeatable).")
        p.add_argument("--today", help="Run as if on this date (YYYY-MM-DD).")
        if name in ("run", "targets"):
            p.add_argument("--no-events", action="store_true", help="Skip the event feeds.")
        if name == "run":
            p.add_argument("--dry-run", action="store_true", help="Search only; render and write nothing.")
            p.add_argument("--max-passes", type=int, default=MAX_PASSES, help="New passes for the whole run.")
            p.add_argument("--max-per-target", type=int, default=ingest.MAX_PASSES_PER_TARGET)
            p.add_argument("--workers", type=int, default=4)
    sub.add_parser("check-token")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    return {"run": cmd_run, "detect": cmd_detect, "targets": cmd_targets,
            "check-token": cmd_check_token}[args.cmd](args)
