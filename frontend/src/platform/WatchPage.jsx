import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import MaturityBadge from "../components/MaturityBadge.jsx";
import { API_BASE, assetUrl, checkWatch, deleteWatch } from "../services/api.js";
import { watchQuery } from "../services/queries.js";
import { forgetWatch, listWatches, rememberWatch, watchPath } from "../services/watches.js";

const STATUS_LABEL = { accepted: "Flagged", pending: "Waiting for the next pass", rejected: "Not flagged" };

const when = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never";

function CheckStatus({ watch }) {
  const s = watch.status?.state;
  if (s === "queued" || s === "running") {
    return (
      <p className="watch-status" role="status">
        <span className="watch-pulse" aria-hidden="true" /> Checking NISAR passes over this area… The first check reads
        up to 12 passes and can take a few minutes.
      </p>
    );
  }
  if (s === "error") return <p className="error small">The last check failed: {watch.status.error}</p>;
  return (
    <p className="muted small">
      Last checked {when(watch.last_checked)}. Re-checked when this page or its feed is opened and the last check is
      over {watch.refresh_hours} hours old.
    </p>
  );
}

function Candidate({ c }) {
  return (
    <li className={`watch-candidate watch-${c.status}`}>
      <span className={`watch-tag watch-tag-${c.status}`}>{STATUS_LABEL[c.status]}</span>
      <strong>{c.headline}</strong>
      <p className="small">{c.explanation}</p>
    </li>
  );
}

function Candidates({ list }) {
  const flagged = list.filter((c) => c.status === "accepted");
  const pending = list.filter((c) => c.status === "pending");
  const rejected = list.filter((c) => c.status === "rejected");
  return (
    <section aria-label="What the checks found">
      <h2>What the checks found</h2>
      {!flagged.length && !pending.length && (
        <p className="muted">Nothing flagged. Every change the detectors looked at is listed below with why it was not flagged.</p>
      )}
      {(flagged.length > 0 || pending.length > 0) && (
        <ul className="watch-candidates">
          {[...flagged, ...pending].map((c) => (
            <Candidate key={`${c.kind}-${c.metric}-${c.start}-${c.end}`} c={c} />
          ))}
        </ul>
      )}
      {rejected.length > 0 && (
        <details className="sources small">
          <summary>Looked at and not flagged ({rejected.length})</summary>
          <ul className="watch-candidates">
            {rejected.map((c) => (
              <Candidate key={`${c.kind}-${c.metric}-${c.start}-${c.end}`} c={c} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Passes({ passes }) {
  if (!passes.length) return null;
  return (
    <section aria-label="Passes checked">
      <h2>Passes checked ({passes.length})</h2>
      <ul className="watch-passes">
        {[...passes].reverse().map((p) => (
          <li key={p.date}>
            <img src={assetUrl(p.image_url)} alt={`NISAR radar view of the area on ${p.date}`} loading="lazy" />
            <span className="small">
              <strong>{p.date}</strong> <MaturityBadge quality={p.quality} date={p.date} />
            </span>
            {p.stats?.water_pct != null && <span className="muted small">open water {p.stats.water_pct}%</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Log({ log }) {
  return (
    <section aria-label="History">
      <h2>History</h2>
      <ol className="watch-log">
        {[...log].reverse().map((e, i) => (
          <li key={`${e.at}-${i}`} className={`watch-log-${e.kind}`}>
            <span className="muted small">{when(e.at)}</span> {e.title}
            {e.summary && <span className="muted small"> · {e.summary}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Watch({ id }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data: watch, error, isPending } = useQuery(watchQuery(id));
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (watch) {
      rememberWatch(watch);
      document.title = `Watching ${watch.name} · NISAR Surface Change Explorer`;
    }
  }, [watch]);

  if (isPending) return <p className="muted" role="status">Loading the watch…</p>;
  if (error) {
    return (
      <p className="error">
        {error.status === 404 ? "This watch doesn't exist, or it was stopped." : error.message}{" "}
        <Link to="/watch">Your watched areas</Link>
      </p>
    );
  }

  const link = `${window.location.origin}${watchPath(id)}`;
  const feed = `${API_BASE || window.location.origin}${watch.feed_url}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const checkNow = async () => {
    setBusy(true);
    try {
      await checkWatch(id);
    } finally {
      setBusy(false);
      client.invalidateQueries({ queryKey: ["watch", id] });
    }
  };
  const stop = async () => {
    if (!window.confirm(`Stop watching ${watch.name}? Its history and images are deleted.`)) return;
    await deleteWatch(id);
    forgetWatch(id);
    navigate("/watch");
  };
  const a = watch.area;
  const running = ["queued", "running"].includes(watch.status?.state);

  return (
    <>
      <header className="watch-head">
        <p className="muted small">NISAR Watch · your area</p>
        <h1>{watch.name}</h1>
        <p className="muted small">
          {a.lat.toFixed(3)}°, {a.lon.toFixed(3)}° · {(a.half_km * 2).toFixed(1)} km box
          {a.clipped ? " (centre of the area you drew)" : ""}
          {watch.frame ? ` · NISAR frame ${watch.frame}` : ""} · since {when(watch.created_at)}
        </p>
        <div className="watch-actions">
          <button type="button" className="btn btn-secondary btn-small" onClick={copy}>
            {copied ? "Link copied" : "Copy private link"}
          </button>
          <a className="btn btn-secondary btn-small" href={feed} target="_blank" rel="noreferrer">
            Subscribe (Atom feed)
          </a>
          <button type="button" className="btn btn-secondary btn-small" onClick={checkNow} disabled={busy || running}>
            Check now
          </button>
          <button type="button" className="btn btn-link btn-small" onClick={stop}>
            Stop watching
          </button>
        </div>
        <p className="watch-disclaimer small">{watch.disclaimer}</p>
        <CheckStatus watch={watch} />
      </header>
      <Candidates list={watch.candidates ?? []} />
      <Passes passes={watch.passes ?? []} />
      <Log log={watch.log ?? []} />
      <p className="muted small">
        Anyone with this page&apos;s link can see and stop this watch. It is stored only on this server, never
        published. How the checks work: <Link to="/docs/developers/automation">NISAR Watch</Link>.
      </p>
    </>
  );
}

function WatchList() {
  const [list] = useState(listWatches);
  return (
    <>
      <header className="watch-head">
        <h1>Your watched areas</h1>
        <p className="muted">
          Areas this browser asked NISAR Watch to re-check on every pass. To add one, draw an area in{" "}
          <Link to="/workspace?mode=investigate">Investigate</Link> and choose Watch this area.
        </p>
      </header>
      {list.length ? (
        <ul className="watch-list">
          {list.map((w) => (
            <li key={w.id}>
              <Link to={watchPath(w.id)}>{w.name}</Link>
              {w.createdAt && <span className="muted small"> · since {when(w.createdAt)}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None yet.</p>
      )}
    </>
  );
}

/** /watch (this browser's watches) and /watch/<id> (one watch). */
export default function WatchPage() {
  const { id } = useParams();
  useEffect(() => {
    if (!id) document.title = "Your watched areas · NISAR Surface Change Explorer";
  }, [id]);
  return (
    <div className="pf-brief watch-page">
      {id && (
        <div className="pf-brief-bar">
          <Link to="/watch">← Your watched areas</Link>
        </div>
      )}
      {id ? <Watch id={id} /> : <WatchList />}
    </div>
  );
}
