import { createPortal } from "react-dom";

function MomentText({ moment }) {
  // "−20.0 mm/month" → a large number and a small unit.
  const [, number, unit] = /^([−+-]?[\d.,]+)\s*(.*)$/.exec(moment.display) ?? [null, moment.display, ""];
  return (
    <>
      <span className="moment-when">
        {moment.title}
        {moment.season && <span className="moment-season">{moment.season}</span>}
      </span>
      <strong className="moment-value">
        {number}
        {unit && <span className="moment-unit" data-tight={unit === "%"}>{unit}</span>}
      </strong>
      <span className="moment-detail">{moment.detail}</span>
    </>
  );
}

/** The selected moment, shown over the map image it describes. */
function MomentPopup({ moment, index, count, onStep, onClose, onSave }) {
  return (
    <aside className="moment-popup" aria-label="What NISAR shows here" aria-live="polite">
      <div className="moment-popup-top">
        <span className="moment-count">NISAR observation · {index + 1} of {count}</span>
        <button type="button" className="moment-close" aria-label="Hide explanation" onClick={onClose}>×</button>
      </div>
      <MomentText moment={moment} />
      <p className="moment-caption">{moment.caption}</p>
      <div className="moment-popup-nav">
        <button type="button" className="btn btn-secondary btn-small" disabled={index === 0} onClick={() => onStep(-1)}>
          ‹ Previous
        </button>
        {onSave && (
          <button type="button" className="btn btn-secondary btn-small" data-tour="save-moment" onClick={() => onSave(moment)}>
            Save
          </button>
        )}
        <button type="button" className="btn btn-secondary btn-small" disabled={index === count - 1} onClick={() => onStep(1)}>
          Next ›
        </button>
      </div>
    </aside>
  );
}

/** The moment pop-up, drawn into `host` over the map when there is one to show. */
export function MomentPortal({ host, shown, moment, index, count, onStep, onClose, onSave }) {
  if (!shown || !moment || !host) return null;
  return createPortal(
    <MomentPopup moment={moment} index={index} count={count} onStep={onStep} onClose={onClose} onSave={onSave} />,
    host,
  );
}

function MomentRow({ moment, active, showDisplay, onSelect }) {
  const label = [moment.season, moment.title, moment.display].filter(Boolean).join(" · ");
  return (
    <li>
      <button type="button" className="moment-row" aria-pressed={active} aria-label={`${label}. ${moment.caption}`} onClick={onSelect}>
        <span className="moment-row-label">
          <span>{moment.season ?? moment.title}</span>
          {moment.season && <span className="moment-date">{moment.title}</span>}
        </span>
        {showDisplay && <span className="moment-detail">{moment.display}</span>}
      </button>
    </li>
  );
}

/**
 * The record's moments, to pick one (its pass and layer go on the map).
 * With the pop-up over the map, the list stays short and starts open;
 * without it, a picked moment's caption shows here.
 */
export function MomentsSection({ moments, active, explained, usePopup, open, onToggle, onSelect, onSave }) {
  if (!moments.length) return null;
  return (
    <section className="chain-moments" aria-label="Moments in the record" data-tour="moments">
      <details className="chain-disclosure moments-disclosure" open={open ?? usePopup} onToggle={(event) => onToggle(event.currentTarget.open)}>
        <summary>
          <span className="moments-heading">
            <span>Moments</span>
            {active && <span className="moments-current">{active.season ?? active.title}</span>}
          </span>
        </summary>
        <ul className="moment-list">
          {moments.map((moment) => (
            <MomentRow key={moment.id} moment={moment} active={moment === active} showDisplay={!usePopup} onSelect={() => onSelect(moment)} />
          ))}
        </ul>
        {active && explained && !usePopup && (
          <div className="moment-summary">
            <p className="chain-note">{active.caption}</p>
            {onSave && <button type="button" className="btn btn-link" onClick={() => onSave(active)}>Save moment</button>}
          </div>
        )}
      </details>
    </section>
  );
}
