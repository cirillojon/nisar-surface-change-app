/**
 * A study site that was just picked, while its passes load. Its name is
 * already in the header and the map is on its way there, so this shows what
 * the list knows (kind, passes, description) in the same places the loaded
 * panel will, then what is still loading, or what went wrong with a way to
 * try again. `embedded` (inside a story) leaves out the back link.
 */
export default function SitePending({
  site,
  changeType,
  error = null,
  onRetry,
  onBack,
  backLabel = "← All places",
  embedded = false,
}) {
  const count = site?.scene_count ?? 0;
  return (
    <article className="site-detail" aria-label={site?.name ?? "Study site"} aria-busy={!error}>
      <header className="detail-overview">
        {!embedded && (
          <button type="button" className="btn btn-link" onClick={onBack}>
            {backLabel}
          </button>
        )}
        {site && (
          <p className="muted small detail-meta">
            <span className="dot" style={{ background: changeType?.color }} />
            {changeType?.label ?? site.change_type}
          </p>
        )}
        {count > 0 && (
          <p className="measurement-coverage muted small">
            {count} NISAR {count === 1 ? "pass" : "passes"}
          </p>
        )}
      </header>
      {error ? (
        <p className="error" role="alert">
          {error}{" "}
          <button type="button" className="btn btn-link" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : (
        <p className="muted" role="status">Loading the NISAR passes…</p>
      )}
      {site?.description && <p>{site.description}</p>}
    </article>
  );
}
