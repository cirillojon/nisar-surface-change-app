import PlaceThumb from "./PlaceThumb.jsx";

/**
 * Stories mode, sidebar: curated places grouped by theme. Each row is a
 * place, pictured by one of its own NISAR passes, with what its record
 * shows; the story's question is asked once it is open (StoryPanel).
 */
export default function StoryList({ data, selected, onSelect }) {
  if (!data) return <p className="panel muted" role="status">Loading stories…</p>;
  if (!data.stories?.length) return <p className="panel muted">No stories could be loaded.</p>;
  const byTheme = (data.themes ?? []).map((t) => ({
    ...t,
    stories: data.stories.filter((s) => s.theme === t.id),
  })).filter((t) => t.stories.length);

  return (
    <section className="story-list" aria-label="Stories">
      <details className="story-method small">
        <summary>How these stories were chosen</summary>
        <p>
          <strong>Study sites</strong> (a year of passes, charted): kept because their NISAR series showed a clear
          change; other candidates were dropped for noise, wind, flat medians or no stable reference point. That
          favors places where something changed.
        </p>
        <p>
          <strong>Before &amp; after places</strong> (change maps): checked after a reported event or where the
          images change with the seasons, and graded by how clearly NISAR shows it. Places checked where it showed
          nothing are listed in Investigate.
        </p>
        <p>
          Data: NISAR GCOV and GUNW (NASA/ISRO, via ASF DAAC); rain and river flow are modeled (ECMWF IFS, ERA5,
          GloFAS, via Open-Meteo). <a href="/docs/data/methods">Data &amp; methods</a>
        </p>
      </details>
      {byTheme.map((theme) => (
        <section key={theme.id} className="story-theme" aria-labelledby={`story-theme-${theme.id}`}>
          <h2 id={`story-theme-${theme.id}`} className="story-theme-title">
            <span className={`story-theme-dot theme-${theme.id}`} aria-hidden="true" />
            {theme.label}
          </h2>
          <ul className="site-items">
            {theme.stories.map((s) => (
              <li key={s.slug}>
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
                  </span>
                  <span className="site-chevron" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
