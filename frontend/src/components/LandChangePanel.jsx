import { STATUS_LABEL } from "../services/landchange.js";

const month = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" });

/** "HH and HV", "HH only" or "HH; HV on 5 of them", counted from the passes. */
function channels(passes) {
  const hv = passes.filter((p) => /HV/.test(p.polarizations ?? "HH+HV")).length;
  if (hv === passes.length) return "HH and HV";
  return hv === 0 ? "HH only" : `HH; HV on ${hv} of them`;
}

/**
 * One land-change place in words: what was reported there, what to look
 * for, and where the images come from. The images are on the map; their
 * dates, layers and change map are in the dock under it (LandPlayer), so
 * nothing here changes while a time-lapse plays. `embedded` (inside a
 * story) leaves out the back link and summary, which the story shows.
 */
export default function LandChangePanel({ site, onBack, changeShown = false, onToggleChange = null, embedded = false }) {
  const { event, passes } = site;
  const first = passes[0]?.date;
  const last = passes[passes.length - 1]?.date;

  return (
    <article className={`panel detail${embedded ? " detail-embedded" : ""}`} aria-label={site.name}>
      {!embedded && (
        <>
          <button type="button" className="btn btn-link" onClick={onBack}>
            ← All places
          </button>
          <p className="muted small detail-meta">
            {site.kind} · {site.region}
            {site.status !== "visible" && (
              <>
                {" "}
                <span className={`badge land-badge-${site.status}`}>{STATUS_LABEL[site.status]}</span>
              </>
            )}
          </p>
          <p>
            <strong>{site.headline}.</strong> {site.story}
          </p>
        </>
      )}
      {event && (
        <p className="small">
          <span className="badge">{event.date}</span> {event.label}
        </p>
      )}
      <div className="callout">
        <strong>What to look for:</strong> {site.look_for}
      </div>
      {onToggleChange && (
        <button type="button" className="btn btn-secondary btn-small land-change-toggle" onClick={onToggleChange}>
          {changeShown ? "Show the images" : "Show the change map"}
        </button>
      )}
      {!embedded && first && (
        <p className="muted small land-record">
          {passes.length} passes · {month(first)} – {month(last)} · {channels(passes)}
        </p>
      )}

      <details className="sources small">
        <summary>About these images</summary>
        <p className="muted">
          NISAR backscatter (GCOV), every pass on track/frame <code>{site.frame}</code> so the images
          line up; ~{site.pixel_m} m pixels. Colours: red = HH, green = HV, blue = HH/HV (grey where
          HV wasn&apos;t collected). Provisional data.
        </p>
        {site.sources?.length > 0 && (
          <ul>
            {site.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </details>
    </article>
  );
}
