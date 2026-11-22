import { useMemo, useState } from "react";

import CodeBlock from "../docs/CodeBlock.jsx";
import { absoluteUrl, buildUrl, codeSamples, exampleFor } from "./spec.js";

const LANG_KEY = "nisar-docs-lang";

function storedLang() {
  try {
    return localStorage.getItem(LANG_KEY) || "curl";
  } catch {
    return "curl";
  }
}

function MethodBadge({ method }) {
  return <span className={`pf-method pf-method-${method.toLowerCase()}`}>{method}</span>;
}

/** Live request runner + language tabs. */
export function TryIt({ operation }) {
  const tryable = operation.op["x-try-it"] !== false;
  const [values, setValues] = useState(() =>
    Object.fromEntries(operation.parameters.map((p) => [p.name, String(exampleFor(p))])),
  );
  const [bodyText, setBodyText] = useState(() =>
    operation.body?.example ? JSON.stringify(operation.body.example, null, 2) : operation.body ? "{}" : null,
  );
  const [lang, setLang] = useState(storedLang);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  const samples = useMemo(() => codeSamples(operation, values, bodyText), [operation, values, bodyText]);
  const sample = samples.find((s) => s.id === lang) ?? samples[0];

  const pickLang = (id) => {
    setLang(id);
    try {
      localStorage.setItem(LANG_KEY, id);
    } catch {
      // Language choice is a convenience only.
    }
  };

  const run = async () => {
    setRunning(true);
    const started = performance.now();
    try {
      const init = { method: operation.method, headers: {} };
      if (operation.method !== "GET" && bodyText != null) {
        JSON.parse(bodyText || "{}");
        init.headers["Content-Type"] = "application/json";
        init.body = bodyText || "{}";
      }
      const resp = await fetch(absoluteUrl(buildUrl(operation, values)), init);
      // An explorer shows whatever the endpoint answers, errors included,
      // labeled with the status; an error without a body shows its reason.
      const text = resp.ok ? await resp.text() : (await resp.text()) || resp.statusText;
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Not JSON: show as-is.
      }
      if (pretty.length > 60000) pretty = `${pretty.slice(0, 60000)}\n… (truncated for display)`;
      setResult({ status: resp.status, ok: resp.ok, ms: Math.round(performance.now() - started), body: pretty });
    } catch (err) {
      setResult({ status: "error", ok: false, ms: Math.round(performance.now() - started), body: String(err?.message || err) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="pf-tryit">
      <div className="pf-tryit-head">
        <div className="pf-tryit-route">
          <MethodBadge method={operation.method} />
          <code>{operation.path}</code>
        </div>
        <div className="pf-lang-tabs" role="tablist" aria-label="Code language">
          {samples.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === sample.id}
              className="pf-lang-tab"
              onClick={() => pickLang(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <CodeBlock code={sample.code} language={sample.id} dark />
      {tryable && (
        <div className="pf-tryit-form">
          {operation.parameters.map((p) => (
            <label key={p.name} className="pf-tryit-field">
              <span>
                <code>{p.name}</code>
                {p.required && <em>required</em>}
              </span>
              {p.schema?.enum ? (
                <select
                  value={values[p.name]}
                  onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
                >
                  {!p.required && <option value="">(none)</option>}
                  {p.schema.enum.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              ) : (
                <input
                  value={values[p.name]}
                  placeholder={p.schema?.format ?? p.schema?.type ?? ""}
                  onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
                />
              )}
            </label>
          ))}
          {bodyText != null && (
            <label className="pf-tryit-field pf-tryit-body">
              <span><code>body</code> JSON</span>
              <textarea
                rows={Math.min(10, bodyText.split("\n").length + 1)}
                value={bodyText}
                spellCheck={false}
                onChange={(e) => setBodyText(e.target.value)}
              />
            </label>
          )}
          <button type="button" className="pf-run-btn" onClick={run} disabled={running}>
            {running ? "Sending…" : "Send request"} <span aria-hidden="true">▶</span>
          </button>
        </div>
      )}
      {result && (
        <div className="pf-tryit-result" aria-live="polite">
          <div className="pf-tryit-status">
            <span className={result.ok ? "pf-ok" : "pf-bad"}>{result.status}</span>
            <span>{result.ms} ms</span>
          </div>
          <CodeBlock code={result.body} language="json" dark maxHeight={360} />
        </div>
      )}
      {!tryable && (
        <p className="pf-tryit-note">This endpoint isn’t runnable from the docs. Use the code above.</p>
      )}
    </div>
  );
}
