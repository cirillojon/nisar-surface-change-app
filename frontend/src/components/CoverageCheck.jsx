import { useQuery } from "@tanstack/react-query";

import { coverageCheckQuery } from "../services/queries.js";

/** "12 passes, every 12 d", "none", or "not checked" for one product's row. */
function passCount(product) {
  if (product.error) return "not checked";
  const best = product.frames?.[0];
  if (!best) return "none";
  const passes = `${best.pass_dates} ${best.pass_dates === 1 ? "pass" : "passes"}`;
  return best.median_revisit_days ? `${passes}, every ${best.median_revisit_days} d` : passes;
}

/**
 * Investigate mode, a drawn area: which NISAR products have passes here.
 * Counts the last year's passes per product on the frame with most of them
 * and how often it repeats, with a plain line on what that is enough for
 * (`/api/coverage-check`).
 */
export default function CoverageCheck({ bbox }) {
  const { data, error, isFetching, refetch } = useQuery(coverageCheckQuery(bbox.join(",")));
  const products = data?.products ?? [];
  // When the catalog is down every product fails the same way: say it once.
  const allFailed = products.length > 0 && products.every((p) => p.error);
  const failure = error ? error.message || "The coverage check failed." : allFailed ? products[0].error : null;
  const frame = products.find((p) => p.best_frame)?.best_frame;
  return (
    <section className="coverage-check" aria-labelledby="coverage-check-title" aria-busy={isFetching}>
      <h2 id="coverage-check-title">NISAR passes over this area</h2>
      {isFetching && <p className="muted small" role="status">Checking NASA&apos;s catalog for the last year…</p>}
      {failure && !isFetching && (
        <div className="coverage-error">
          <p className="error small" role="alert">{failure}</p>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => refetch()}>
            Try again
          </button>
        </div>
      )}
      {data && !allFailed && !error && (
        <>
          <ul className="coverage-list small">
            {products.map((p) => (
              <li key={p.product} className={p.frames?.[0] ? undefined : "is-empty"}>
                <span><strong>{p.product}</strong> {passCount(p)}</span>
                <span className="muted">{p.error ?? p.verdict}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            Counted on the frame with most passes{frame ? ` (${frame})` : ""}, {data.start} to {data.end}.
          </p>
        </>
      )}
    </section>
  );
}
