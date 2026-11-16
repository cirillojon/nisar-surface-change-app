import { useEffect, useState } from "react";

import { fetchCoverageCheck } from "../services/api.js";

/**
 * Investigate mode, a drawn area: which NISAR products have passes here.
 * Counts the last year's passes per product on the frame with most of them
 * and how often it repeats, with a plain line on what that is enough for
 * (`/api/coverage-check`).
 */
export default function CoverageCheck({ bbox }) {
  const key = bbox.join(",");
  const [state, setState] = useState({ loading: true });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ loading: true });
    fetchCoverageCheck(key)
      .then((data) => live && setState({ data }))
      .catch((e) => live && setState({ error: e?.message || "The coverage check failed." }));
    return () => {
      live = false;
    };
  }, [key, tries]);

  const products = state.data?.products ?? [];
  // When the catalog is down every product fails the same way: say it once.
  const allFailed = products.length > 0 && products.every((p) => p.error);
  const retry = (
    <button type="button" className="btn btn-secondary btn-small" onClick={() => setTries((n) => n + 1)}>
      Try again
    </button>
  );
  const frame = state.data?.products.find((p) => p.best_frame)?.best_frame;
  return (
    <section className="coverage-check" aria-labelledby="coverage-check-title" aria-busy={state.loading}>
      <h2 id="coverage-check-title">NISAR passes over this area</h2>
      {state.loading && <p className="muted small" role="status">Checking NASA&apos;s catalog for the last year…</p>}
      {(state.error || allFailed) && (
        <div className="coverage-error">
          <p className="error small" role="alert">{state.error ?? products[0].error}</p>
          {retry}
        </div>
      )}
      {state.data && !allFailed && (
        <>
          <ul className="coverage-list small">
            {state.data.products.map((p) => {
              const best = p.frames?.[0];
              const count = p.error
                ? "not checked"
                : best
                ? `${best.pass_dates} ${best.pass_dates === 1 ? "pass" : "passes"}${best.median_revisit_days ? `, every ${best.median_revisit_days} d` : ""}`
                : "none";
              return (
                <li key={p.product} className={best ? undefined : "is-empty"}>
                  <span><strong>{p.product}</strong> {count}</span>
                  <span className="muted">{p.error ?? p.verdict}</span>
                </li>
              );
            })}
          </ul>
          <p className="muted small">
            Counted on the frame with most passes{frame ? ` (${frame})` : ""}, {state.data.start} to {state.data.end}.
          </p>
        </>
      )}
    </section>
  );
}
