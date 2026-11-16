import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAssistant } from "./assistant/assistantStore.jsx";
import { loadAllRaw } from "./docs/content.js";
import { allPages } from "./docs/nav.js";
import { AI_ENABLED } from "./features.js";

function plain(text) {
  return text
    .replace(/^export const meta[\s\S]*?\n};?\n/m, "")
    .replace(/^(import|export) .*$/gm, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*`>|{}[\]()_-]+/g, " ")
    .replace(/\s+/g, " ");
}

/** Ctrl/⌘K search over every docs page (titles first, then full text). */
export default function CommandPalette({ open, onClose }) {
  const [query, setQuery] = useState("");
  const [corpus, setCorpus] = useState(null);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const { ask } = useAssistant();
  const pages = useMemo(() => allPages(), []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    setTimeout(() => inputRef.current?.focus(), 0);
    if (!corpus) {
      loadAllRaw().then((rows) => setCorpus(Object.fromEntries(rows.map((r) => [r.key, plain(r.text)]))));
    }
  }, [open, corpus]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = [
      { key: "workspace", title: "Open the map workspace", section: "Workspace", href: "/workspace" },
      // Listed only when searched for ("demo", "pitch", "present").
      { key: "demo", title: "Demo mode", section: "Workspace · for presenting a pitch", href: "/workspace?demo=1", hidden: true, demo: true },
      ...pages.map((p) => ({
        key: `${p.tab.id}/${p.slug}`,
        title: p.title,
        section: `${p.tab.label} · ${p.section}`,
        href: `/docs/${p.tab.id}/${p.slug}`,
      })),
    ];
    if (!q) return base.filter((r) => !r.hidden).slice(0, 9);
    const words = q.split(/\s+/).filter(Boolean);
    return base
      .map((r) => {
        const title = r.title.toLowerCase();
        const text = corpus?.[r.key]?.toLowerCase() ?? "";
        let score = 0;
        for (const w of words) {
          if (title.includes(w)) score += 10;
          if (r.demo && /^(pitch|present)/.test(w)) score += 10;
          if (r.section.toLowerCase().includes(w)) score += 3;
          const hits = text.split(w).length - 1;
          score += Math.min(hits, 8);
        }
        let snippet = "";
        const pos = text.indexOf(words[0]);
        if (pos >= 0) snippet = corpus[r.key].slice(Math.max(0, pos - 50), pos + 110);
        return { ...r, score, snippet };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }, [query, corpus, pages]);

  if (!open) return null;

  const go = (r) => {
    onClose();
    // Demo mode runs full screen (a click allows it; the demo leaves it on exit).
    if (r.demo) document.documentElement.requestFullscreen?.().catch(() => {});
    if (r.ask) ask(r.ask);
    else navigate(r.href);
  };
  const askItem = AI_ENABLED && query.trim() ? { key: "ask", title: `Ask AI: “${query.trim()}”`, section: "Assistant", ask: query.trim() } : null;
  const items = askItem ? [...results, askItem] : results;

  return (
    <div
      className="pf-palette-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="pf-palette" role="dialog" aria-modal="true" aria-label="Search the docs">
        <input
          ref={inputRef}
          className="pf-palette-input"
          placeholder="Search docs, concepts, endpoints…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === "Enter" && items[cursor]) go(items[cursor]);
          }}
          aria-label="Search"
        />
        <ul className="pf-palette-list" role="listbox">
          {items.map((r, i) => (
            <li key={r.key} role="option" aria-selected={i === cursor}>
              <button type="button" onMouseEnter={() => setCursor(i)} onClick={() => go(r)}>
                <span className="pf-palette-title">{r.title}</span>
                <span className="pf-palette-section">{r.section}</span>
                {r.snippet && <span className="pf-palette-snippet">…{r.snippet}…</span>}
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="pf-muted pf-palette-empty">No matches.</li>}
        </ul>
        <p className="pf-palette-foot"><kbd>↑↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close</p>
      </div>
    </div>
  );
}
