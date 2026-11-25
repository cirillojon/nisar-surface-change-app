import { assessPass } from "../services/maturity.js";

/**
 * A pass's release tier (validated / provisional / beta) plus small flags for
 * every caveat that applies: replaced by the 2027 reprocessing, in the
 * acquisition gap, Urgent Response. Hover or focus reads the full notes.
 */
export default function MaturityBadge({ quality, date, product, urgentResponse, maturity }) {
  const m = assessPass({ quality, date, product, urgentResponse, maturity });
  if (m.tier === "unknown" && !quality) return null;
  const label = m.tier === "unknown" ? quality : m.tier;
  const notes = m.notes.join(" ");
  return (
    <span className="maturity" title={notes}>
      <span className={`badge badge-${m.tier}`}>{label}</span>
      <span className="visually-hidden">{notes}</span>
      {m.superseded_by_reprocessing && (
        <span className="badge badge-flag" aria-hidden="true">
          ↻ 2027
        </span>
      )}
      {m.urgent_response && (
        <span className="badge badge-flag badge-urgent" aria-hidden="true">
          preliminary
        </span>
      )}
    </span>
  );
}
