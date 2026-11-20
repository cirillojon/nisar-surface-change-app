import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "../../platform/icons.jsx";
import { placeSearchQuery } from "../../services/queries.js";

/**
 * Typing, the name searched for (on Enter: OpenStreetMap's geocoder asks for
 * no search-as-you-type), its results, the one the arrow keys are on, and
 * whether the list is open.
 */
function usePlaceSearch() {
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState(false);
  const search = useQuery(placeSearchQuery(submitted));
  const results = search.data?.results ?? [];
  const submit = () => {
    const q = text.trim().replace(/\s+/g, " ");
    if (q.length < 2) return;
    setSubmitted(q);
    setCursor(0);
    setOpen(true);
  };
  return { text, setText, submitted, search, results, cursor, setCursor, open, setOpen, submit };
}

/** What the list says while it has no places to offer (null: nothing to say). */
function searchNote(search, results) {
  if (search.isFetching && !results.length) return "Searching…";
  if (search.isError) return search.error?.message ?? "Place search is unavailable.";
  if (search.isSuccess && !results.length) return "No places found. Try another spelling, or add the country.";
  return null;
}

function PlaceResults({ listId, optionId, search, results, cursor, setCursor, onPick }) {
  const note = searchNote(search, results);
  const attribution = search.data?.attribution;
  return (
    <div className="place-results">
      {note && <p className="place-note" role="status">{note}</p>}
      {results.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Places">
          {results.map((place, i) => (
            // Picked with the keyboard from the search field (aria-activedescendant), or clicked.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <li
              key={`${place.label}|${place.latitude},${place.longitude}`}
              id={optionId(i)}
              role="option"
              aria-selected={i === cursor}
              onMouseEnter={() => setCursor(i)}
              // Before the field loses focus, so the list is still there to click.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(place)}
            >
              <span className="place-name">{place.name}</span>
              <span className="place-label">{place.label}</span>
            </li>
          ))}
        </ul>
      )}
      {attribution && (
        <p className="place-credit">
          Search <a href={attribution.url} target="_blank" rel="noreferrer">{attribution.text}</a>
        </p>
      )}
    </div>
  );
}

/**
 * Find a place by name and open it as a search area: the map flies there and
 * lists the NISAR passes over it. Enter searches (and, on a result, opens it);
 * the arrow keys move through the results and Escape closes them.
 */
export default function PlaceSearch({ onPick }) {
  const s = usePlaceSearch();
  const { results, cursor, setCursor, open, setOpen } = s;
  const box = useRef(null);
  const id = useId();
  const listId = `${id}-places`;
  const optionId = (i) => `${id}-place-${i}`;
  const showing = open && s.submitted !== "";
  const choosable = showing && results.length > 0 && s.text.trim().replace(/\s+/g, " ") === s.submitted;

  // A click elsewhere closes the list.
  useEffect(() => {
    if (!showing) return undefined;
    const onDown = (e) => {
      if (!box.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [showing, setOpen]);

  const pick = (place) => {
    setOpen(false);
    s.setText(place.name);
    onPick(place);
  };
  const onKeyDown = (e) => {
    if (e.key === "Escape" && showing) {
      // Only the list closes, not a drawing or panel behind it.
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown" && choosable) {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp" && choosable) {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    }
  };
  const onSubmit = (e) => {
    e.preventDefault();
    if (choosable) pick(results[cursor]);
    else s.submit();
  };

  return (
    <form ref={box} className="place-search" role="search" aria-label="Find a place" onSubmit={onSubmit}>
      <Icon name="search" size={15} strokeWidth={2} />
      <input
        type="search"
        className="place-input"
        placeholder="Find a place…"
        value={s.text}
        onChange={(e) => s.setText(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => s.submitted && setOpen(true)}
        role="combobox"
        aria-label="Place name"
        aria-expanded={choosable}
        aria-controls={listId}
        aria-activedescendant={choosable ? optionId(cursor) : undefined}
        aria-autocomplete="list"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        maxLength={120}
      />
      {showing && (
        <PlaceResults listId={listId} optionId={optionId} search={s.search} results={results} cursor={cursor} setCursor={setCursor} onPick={pick} />
      )}
    </form>
  );
}
