import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { API_BASE } from "../../services/api.js";
import { useWorkspaceContext } from "../workspaceContext.js";
import { useAssistant } from "./assistantStore.jsx";
import Markdown from "./Markdown.jsx";

const TOOL_LABELS = {
  list_sites: "Listing study sites",
  get_site_timeseries: "Reading the site's NISAR time series",
  explain_site_change: "Checking possible causes",
  list_change_types: "Looking up change types",
  list_products: "Looking up NISAR products",
  search_granules: "Searching NASA's NISAR catalog",
  area_rain: "Getting rain for the area",
  soil_moisture_scene: "Reading soil moisture",
  list_land_change: "Browsing the land-change gallery",
  height_profile: "Measuring ground motion along the line",
  search_docs: "Searching the docs",
  open_in_workspace: "Preparing a map link",
};

function suggestions(pathname, ws) {
  if (pathname.startsWith("/workspace")) {
    if (ws.site) {
      return [
        `What am I looking at in ${ws.site.name}${ws.date ? ` on ${ws.date}` : ""}?`,
        `What could explain the change at ${ws.site.name}? How strong is the evidence?`,
        "How do I read the colours in this image?",
      ];
    }
    return [
      "Which study site shows flooding best?",
      "How do I check whether my area is sinking?",
      "What does the Draw line tool measure?",
    ];
  }
  if (pathname.startsWith("/docs/developers")) {
    return [
      "Write Python that gets Sylhet's open-water series and plots it",
      "How do I add the MCP server to Claude Code?",
      "Find GUNW granules over Mexico City from the last 60 days",
    ];
  }
  return [
    "Explain radar backscatter like I'm 12",
    "Why can L-band see floods under trees?",
    "Which NISAR product should I use to monitor crops?",
  ];
}

function useStatus(open) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    if (!open || status) return;
    fetch(`${API_BASE}/api/assistant/status`)
      .then((r) => (r.ok ? r.json() : { enabled: false, unreachable: !r.ok }))
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, unreachable: true }));
  }, [open, status]);
  return status;
}

export default function AssistantDrawer() {
  const { open, close, messages, busy, draft, setDraft, send, stop, reset } = useAssistant();
  const { pathname } = useLocation();
  const ws = useWorkspaceContext();
  const status = useStatus(open);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === "Escape" && open) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;
  const disabled = status && !status.enabled;

  const submit = (e) => {
    e.preventDefault();
    send(draft);
  };

  return (
    <aside id="pf-assistant" className="pf-assistant" aria-label="AI assistant">
      <header className="pf-assistant-head">
        <div>
          <p className="pf-assistant-title"><span aria-hidden="true">✦</span> NISAR Assistant</p>
          <p className="pf-assistant-sub">
            {status?.enabled ? `Grounded in this platform's data and docs · ${status.model}` : "Ask about radar, NISAR data, the API or the map"}
          </p>
        </div>
        <div className="pf-assistant-actions">
          {messages.length > 0 && (
            <button type="button" className="pf-icon-btn" onClick={reset} title="New conversation">New</button>
          )}
          <button type="button" className="pf-icon-btn" onClick={close} aria-label="Close assistant">✕</button>
        </div>
      </header>
      {pathname.startsWith("/workspace") && ws.site && (
        <p className="pf-assistant-context">
          Looking at <strong>{ws.site.name}</strong>{ws.date && <> · pass {ws.date}</>}
        </p>
      )}
      <div className="pf-assistant-list" ref={listRef}>
        {disabled && (
          <div className="pf-callout pf-callout-warn">
            {status.unreachable ? (
              <>The backend isn’t reachable, so the assistant can’t answer. Start it with <code>bin/start dev</code>.</>
            ) : (
              <>
                The assistant isn’t configured on this server. Add <code>ANTHROPIC_API_KEY</code> to the backend’s{" "}
                <code>.env</code> and restart it. <Link to="/docs/developers/assistant" onClick={close}>How it works</Link>
              </>
            )}
          </div>
        )}
        {messages.length === 0 && !disabled && (
          <div className="pf-assistant-empty">
            <p>I can explain the science, find NISAR data, write API calls and open the map where it matters.</p>
            <ul className="pf-suggestions">
              {suggestions(pathname, ws).map((s) => (
                <li key={s}><button type="button" onClick={() => send(s)}>{s}</button></li>
              ))}
            </ul>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`pf-msg pf-msg-${m.role}`}>
            {m.role === "user" ? (
              <p>{m.content}</p>
            ) : (
              <>
                {m.tools.length > 0 && (
                  <ul className="pf-msg-tools">
                    {m.tools.map((t) => (
                      <li key={t.id} className={t.done ? (t.ok ? "is-ok" : "is-bad") : "is-running"}>
                        <span className="pf-tool-dot" aria-hidden="true" />
                        {TOOL_LABELS[t.name] ?? t.name}
                        {t.done && t.summary && <span className="pf-tool-summary"> · {t.summary}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {m.content && <Markdown text={m.content} />}
                {m.pending && !m.content && <p className="pf-typing" aria-label="Thinking">●●●</p>}
                {m.actions.map((a) => (
                  <Link key={a.url} className="pf-open-ws" to={a.url}>{a.label} →</Link>
                ))}
                {m.error && <p className="pf-msg-error" role="alert">{m.error}</p>}
                {m.stopped && <p className="pf-muted">Stopped.</p>}
              </>
            )}
          </div>
        ))}
      </div>
      <form className="pf-assistant-form" onSubmit={submit}>
        <textarea
          ref={inputRef}
          rows={2}
          value={draft}
          placeholder={disabled ? "Assistant unavailable" : "Ask anything about NISAR…"}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          aria-label="Message the assistant"
        />
        {busy ? (
          <button type="button" className="pf-send" onClick={stop}>Stop</button>
        ) : (
          <button type="submit" className="pf-send" disabled={!draft.trim() || disabled}>Send</button>
        )}
      </form>
      <p className="pf-assistant-foot">AI answers can be wrong. Check numbers against the data and cited pages.</p>
    </aside>
  );
}
