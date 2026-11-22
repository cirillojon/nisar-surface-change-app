"""Auto-detected stories and the places behind them (``app/data/auto/``).

Written by the NISAR Watch job (``python -m pipeline``, see
docs/AUTOMATION.md) and committed like the rest of ``app/data``:

* ``places.json``  – watched places in the land-change gallery's format, one
  per target, with every pass processed so far (images under
  ``app/data/scenes/auto/<slug>/``) and per-pass box statistics.
* ``stories.json`` – templated, numbers-only stories, ``origin: "auto"``.
  Only ``status: "active"`` ones are shown; retracted and superseded ones stay
  in the file (and in each story's ``history``) for the record.

Auto stories use ``source: "landchange"`` and the same slug as their place,
so findings, thumbnails and the workspace treat them like gallery stories.
"""
from __future__ import annotations

import copy
import json
from functools import lru_cache
from pathlib import Path

AUTO_DIR = Path(__file__).resolve().parent / "data" / "auto"
PLACES_PATH = AUTO_DIR / "places.json"
STORIES_PATH = AUTO_DIR / "stories.json"

STATUS = "auto"
STATUS_LABEL = "Auto-detected, not reviewed"
ACTIVE = "active"


@lru_cache(maxsize=4)
def _read(path: str, mtime: float) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _load(path: Path, key: str) -> list[dict]:
    if not path.is_file():
        return []
    return _read(str(path), path.stat().st_mtime).get(key) or []


def mtime() -> float:
    """Changes whenever either auto file does (for callers' caches)."""
    return sum(p.stat().st_mtime for p in (PLACES_PATH, STORIES_PATH) if p.is_file())


def all_stories() -> list[dict]:
    return _load(STORIES_PATH, "stories")


def stories() -> list[dict]:
    """Active auto stories, as copies (callers may add fields)."""
    return [copy.deepcopy(s) for s in all_stories() if s.get("status") == ACTIVE]


def places() -> list[dict]:
    return _load(PLACES_PATH, "sites")


def gallery_places() -> list[dict]:
    """Auto places that have an active story, ready to join ``landchange.json``'s sites.

    A place without a story is only watched; it stays out of the gallery.
    """
    shown = {s["slug"]: s for s in all_stories() if s.get("status") == ACTIVE}
    out = []
    for p in places():
        story = shown.get(p["slug"])
        if story is None:
            continue
        p = copy.deepcopy(p)
        p.pop("stats_note", None)
        p["status"] = STATUS
        p["origin"] = "auto"
        p["suggested"] = list(story["pair"])
        p["headline"] = story["title"]
        out.append(p)
    return out
