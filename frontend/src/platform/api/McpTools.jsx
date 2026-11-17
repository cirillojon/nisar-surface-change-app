import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { API_BASE } from "../../services/api.js";
import CodeBlock from "../docs/CodeBlock.jsx";
import { schemaFields } from "./spec.js";

/* The MCP tool reference, rendered live from GET /api/tools: the same
 * registry the MCP server lists, so this page can never drift from it. */

function ToolCard({ tool }) {
  const props = tool.input_schema?.properties ?? {};
  const required = new Set(tool.input_schema?.required ?? []);
  const example = Object.fromEntries(
    Object.entries(props)
      .filter(([k]) => required.has(k))
      .map(([k, p]) => [k, EXAMPLES[k] ?? (p.type === "array" ? [] : p.type === "integer" ? 1 : "")]),
  );
  const [args, setArgs] = useState(() => JSON.stringify(EXAMPLE_ARGS[tool.name] ?? example, null, 2));
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const fields = schemaFields(tool.input_schema).map((f) => ({ ...f, required: required.has(f.name) }));
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: tool.name, arguments: safeParse(args) ?? {} },
  };

  const run = async () => {
    setBusy(true);
    const started = performance.now();
    try {
      const parsed = JSON.parse(args || "{}");
      const resp = await fetch(`${API_BASE}/api/tools/${tool.name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await resp.json();
      const text = JSON.stringify(resp.ok ? data.result : data, null, 1);
      setResult({ ok: resp.ok, ms: Math.round(performance.now() - started), text: text.length > 40000 ? `${text.slice(0, 40000)}\n…` : text });
    } catch (err) {
      setResult({ ok: false, ms: 0, text: String(err?.message || err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pf-endpoint" id={tool.name}>
      <div className="pf-endpoint-text">
        <h2 className="pf-endpoint-title"><a href={`#${tool.name}`}>{tool.title}</a></h2>
        <p className="pf-endpoint-route"><span className="pf-method pf-method-tool">TOOL</span> <code>{tool.name}</code></p>
        <p>{tool.description}</p>
        <h3>Arguments</h3>
        {fields.length ? (
          <ul className="pf-fields">
            {fields.map((f) => (
              <li key={f.name}>
                <div className="pf-field-head">
                  <code className="pf-field-name">{f.name}</code>
                  <span className="pf-field-type">{f.type}</span>
                  {f.required && <span className="pf-field-req">required</span>}
                </div>
                {f.description && <p className="pf-field-desc">{f.description}</p>}
                {f.enum && <p className="pf-field-enum">One of {f.enum.map((v) => <code key={v}>{v}</code>)}</p>}
              </li>
            ))}
          </ul>
        ) : <p className="pf-muted">None.</p>}
      </div>
      <div className="pf-endpoint-code">
        <div className="pf-tryit">
          <CodeBlock code={JSON.stringify(request, null, 2)} language="MCP request (JSON-RPC)" dark />
          <div className="pf-tryit-form">
            <label className="pf-tryit-field pf-tryit-body">
              <span><code>arguments</code> JSON</span>
              <textarea rows={Math.min(8, args.split("\n").length + 1)} value={args} spellCheck={false} onChange={(e) => setArgs(e.target.value)} />
            </label>
            <button type="button" className="pf-run-btn" onClick={run} disabled={busy}>
              {busy ? "Running…" : "Run tool"} <span aria-hidden="true">▶</span>
            </button>
          </div>
          {result && (
            <div className="pf-tryit-result" aria-live="polite">
              <div className="pf-tryit-status">
                <span className={result.ok ? "pf-ok" : "pf-bad"}>{result.ok ? "result" : "isError"}</span>
                <span>{result.ms} ms</span>
              </div>
              <CodeBlock code={result.text} language="json" dark maxHeight={360} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const EXAMPLES = { site: "Sylhet", bbox: [91.0, 24.6, 91.6, 25.2], start: "2026-06-01", end: "2026-09-30", query: "polarization", granule: "" };
const EXAMPLE_ARGS = {
  list_sites: {},
  get_site_timeseries: { site: "Sylhet", metric: "water_pct" },
  explain_site_change: { site: "Sylhet" },
  search_granules: { bbox: [91.0, 24.6, 91.6, 25.2], product: "GCOV", limit: 5 },
  area_rain: { bbox: [91.0, 24.6, 91.6, 25.2], start: "2026-06-01", end: "2026-09-30" },
  list_land_change: { kind: "volcano" },
  height_profile: { line: [[-155.335, 19.392], [-155.231, 19.425]] },
  search_docs: { query: "why is HV higher over crops" },
  find_place: { query: "Lake Chad" },
  open_in_workspace: { site: "Mexico City" },
};

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The backend's tool registry (GET /api/tools). */
const toolsQuery = {
  queryKey: ["mcp-tools"],
  queryFn: async () => {
    const r = await fetch(`${API_BASE}/api/tools`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()).tools;
  },
};

export default function McpTools() {
  const { data: tools, error: failure } = useQuery(toolsQuery);
  const error = failure?.message ?? null;
  return (
    <div className="pf-reference">
      <p className="pf-eyebrow">MCP server</p>
      <h1>Tool reference</h1>
      <p className="pf-lede">
        Every tool the MCP server exposes, listed live from the backend’s tool registry. The same tools power
        the <a href="/docs/developers/assistant">AI assistant</a>. Run any of them here: the request is the
        JSON-RPC <code>tools/call</code> an MCP client sends, and the result is what the agent reads.
      </p>
      {error && <div className="pf-callout pf-callout-warn">Couldn’t load tools from the backend ({error}). Is it running?</div>}
      {!tools && !error && <p className="pf-muted" role="status">Loading tools…</p>}
      {tools && (
        <nav className="pf-toolindex" aria-label="Tools">
          {tools.map((t) => <a key={t.name} href={`#${t.name}`}><code>{t.name}</code></a>)}
        </nav>
      )}
      {tools?.map((t) => <ToolCard key={t.name} tool={t} />)}
    </div>
  );
}
