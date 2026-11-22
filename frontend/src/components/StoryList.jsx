import { useEffect, useState } from "react";

import { fetchStoryFeed } from "../services/api.js";
import { STATUS_LABEL } from "../services/landchange.js";
import PlaceThumb from "./PlaceThumb.jsx";

const monthFmt = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const asDay = (iso) => new Date(`${iso}T00:00:00Z`);
const PAGE = 20;

/** One story in a list: its thumbnail, name and title, and an auto-detected badge. */
function StoryRow({ s, selected, onSelect, showDate = false }) {
  return (
    <li>
      <button
        type="button"
        className="site-item story-item"
        aria-current={selected === s.slug ? "true" : undefined}
        onClick={() => onSelect(s)}
      >
        <PlaceThumb url={s.thumb_url} date={s.thumb_date} />
        <span className="site-copy">
          <strong>{s.name ?? s.title}</strong>
          {s.name && <span className="muted">{s.title}</span>}
          {(showDate || s.origin === "auto") && (
            <span className="story-item-meta small">
              {showDate && s.date && <time dateTime={s.date}>{dayFmt.format(asDay(s.date))}</time>}
              {s.origin === "auto" && <span className="badge land-badge-auto">{STATUS_LABEL.auto}</span>}
            </span>
          )}
        </span>
        <span className="site-chevron" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Rows grouped by the month of the period they show, newest first. */
function byMonth(rows) {
  const groups = [];
  for (const s of rows) {
    const key = (s.date ?? "").slice(0, 7);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.stories.push(s);
    else groups.push({ key, label: key ? monthFmt.format(asDay(`${key}-01`)) : "Undated", stories: [s] });
  }
  return groups;
}

/** Latest: every story newest first, filtered by theme, origin and dates, a page at a time. */
function LatestStories({ themes, selected, onSelect }) {
  const [filters, setFilters] = useState({ theme: "", origin: "", since: "", until: "" });
  const [rows, setRows] = useState(null);
  const [page, setPage] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    fetchStoryFeed({ ...filters, limit: PAGE })
      .then((body) => {
        if (!live) return;
        setRows(body.stories);
        setPage(body);
      })
      .catch((e) => live && setError(e?.response?.data?.message || e?.message || "Couldn't load the stories."));
    return () => {
      live = false;
    };
  }, [filters, attempt]);

  const more = () => fetchStoryFeed({ ...filters, limit: PAGE, offset: page.next_offset })
    .then((body) => {
      setRows((r) => [...r, ...body.stories]);
      setPage(body);
    })
    .catch((e) => setError(e?.message || "Couldn't load more stories."));
  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const datesBackwards = filters.since && filters.until && filters.since > filters.until;

  return (
    <section className="story-latest" aria-label="Latest stories">
      <form className="story-filters small" onSubmit={(e) => e.preventDefault()}>
        <label>
          Theme
          <select value={filters.theme} onChange={set("theme")}>
            <option value="">All</option>
            {themes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label>
          Found by
          <select value={filters.origin} onChange={set("origin")}>
            <option value="">Anyone</option>
            <option value="curated">The team (reviewed)</option>
            <option value="auto">NISAR Watch (not reviewed)</option>
          </select>
        </label>
        <label>
          From
          <input type="date" value={filters.since} onChange={set("since")} />
        </label>
        <label>
          To
          <input type="date" value={filters.until} onChange={set("until")} />
        </label>
      </form>
      {page?.latest_detection && (
        <p className="small muted">NISAR Watch last found a change on {dayFmt.format(asDay(page.latest_detection))}.</p>
      )}
      {datesBackwards ? (
        <p className="error" role="alert">&ldquo;From&rdquo; is after &ldquo;To&rdquo;.</p>
      ) : error ? (
        <p className="error" role="alert">
          {error}{" "}
          <button type="button" className="btn btn-link" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </p>
      ) : !rows ? (
        <p className="muted" role="status">Loading stories…</p>
      ) : !rows.length ? (
        <p className="muted">No stories match.</p>
      ) : (
        <>
          {byMonth(rows).map((g) => (
            <section key={g.key || "undated"} className="story-theme" aria-label={g.label}>
              <h2 className="story-theme-title">{g.label}</h2>
              <ul className="site-items">
                {g.stories.map((s) => <StoryRow key={s.slug} s={s} selected={selected} onSelect={onSelect} showDate />)}
              </ul>
            </section>
          ))}
          <p className="small muted">
            {rows.length} of {page.total}
            {page.next_offset != null && (
              <>
                {" · "}
                <button type="button" className="btn btn-link" onClick={more}>Show more</button>
              </>
            )}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Stories mode, sidebar: the places grouped by theme, or Latest (newest
 * first, with filters). Each row is a place, pictured by one of its own
 * NISAR passes, with what its record shows; the story's question is asked
 * once it is open (StoryPanel). Stories found by NISAR Watch carry a
 * "not reviewed" badge.
 */
export default function StoryList({ data, selected, onSelect, view = "theme", onViewChange }) {
  if (!data) return <p className="panel muted" role="status">Loading stories…</p>;
  if (!data.stories?.length) return <p className="panel muted">No stories could be loaded.</p>;
  const byTheme = (data.themes ?? []).map((t) => ({
    ...t,
    stories: data.stories.filter((s) => s.theme === t.id),
  })).filter((t) => t.stories.length);
  const latest = view === "latest";

  return (
    <section className="story-list" aria-label="Stories">
      {onViewChange && (
        <div className="story-view-switch" role="group" aria-label="Show stories">
          {[["theme", "By theme"], ["latest", "Latest"]].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="btn btn-small btn-secondary"
              aria-pressed={view === id}
              onClick={() => onViewChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <details className="story-method small">
        <summary>How these stories were chosen</summary>
        <p>
          <strong>Study sites</strong> (a year of passes, charted): kept because their NISAR series showed a clear
          change; other candidates were dropped for noise, wind, flat medians or no stable reference point. That
          favours places where something changed.
        </p>
        <p>
          <strong>Before &amp; after places</strong> (change maps): checked after a reported event or where the
          images change with the seasons, and graded by how clearly NISAR shows it. Places checked where it showed
          nothing are listed in Investigate.
        </p>
        <p>
          Data: NISAR GCOV and GUNW (NASA/ISRO, via ASF DAAC); rain and river flow are modelled (ECMWF IFS, ERA5,
          GloFAS, via Open-Meteo). <a href="/docs/data/methods">Data &amp; methods</a>
        </p>
        <p>
          <strong>Auto-detected</strong> stories are found by NISAR Watch, a daily job that checks new passes
          for a lasting change and writes only what it measured. No person has reviewed them.
        </p>
      </details>
      {latest && <LatestStories themes={data.themes ?? []} selected={selected} onSelect={onSelect} />}
      {!latest && byTheme.map((theme) => (
        <section key={theme.id} className="story-theme" aria-labelledby={`story-theme-${theme.id}`}>
          <h2 id={`story-theme-${theme.id}`} className="story-theme-title">
            <span className={`story-theme-dot theme-${theme.id}`} aria-hidden="true" />
            {theme.label}
          </h2>
          <ul className="site-items">
            {theme.stories.map((s) => <StoryRow key={s.slug} s={s} selected={selected} onSelect={onSelect} />)}
          </ul>
        </section>
      ))}
    </section>
  );
}
