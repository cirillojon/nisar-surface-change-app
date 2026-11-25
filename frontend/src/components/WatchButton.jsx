import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { createWatch } from "../services/api.js";
import { rememberWatch, watchPath } from "../services/watches.js";

/**
 * "Watch this area": asks the server to re-check the box on every NISAR pass
 * and opens the watch's page (a private link, remembered in this browser).
 */
export default function WatchButton({ bbox, name }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const w = await createWatch({ bbox, name });
      rememberWatch(w);
      navigate(watchPath(w.id));
    } catch (err) {
      setError(err?.message || "Couldn't start watching this area");
      setBusy(false);
    }
  };

  return (
    <div className="watch-cta">
      <button type="button" className="btn btn-secondary btn-small" onClick={start} disabled={busy}>
        {busy ? "Starting…" : "👁 Watch this area"}
      </button>
      <span className="muted small">
        Re-checked on every NISAR pass (about every 12 days). Informational, not a warning.
      </span>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
