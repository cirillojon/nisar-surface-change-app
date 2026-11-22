import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAssistant } from "./assistant/assistantStore.jsx";
import { loadAllRaw } from "./docs/content.js";
import { useStableCallback } from "../services/useStableCallback.js";
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

  // Each opening starts empty, with the field focused.
  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
    setCursor(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  // The pages' full text, loaded on first open (titles are searchable before
  // it arrives, and if it can't load). Kept apart from the effect above, so
  // its arrival doesn't clear what has been typed meanwhile.
  useEffect(() => {
    if (!open || corpus) return undefined;
    let canceled = false;
    loadAllRaw()
      .then((rows) => {
        if (!canceled) setCorpus(Object.fromEntries(rows.map((r) => [r.key, plain(r.text)])));
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
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
    <PaletteDialog onClose={onClose}>
      <PaletteSearch
        inputRef={inputRef}
        query={query}
        items={items}
        cursor={cursor}
        setCursor={setCursor}
        onQuery={(value) => {
          setQuery(value);
          setCursor(0);
        }}
        onGo={go}
        onClose={onClose}
      />
    </PaletteDialog>
  );
}

const optionId = (item) => `palette-option-${item.key}`;

/**
 * The palette as a native modal dialog: the page behind is inert, focus stays
 * in it, and Escape (or a click on the backdrop) closes it.
 */
function PaletteDialog({ onClose: close, children }) {
  const dialogRef = useRef(null);
  // Stable, so a new onClose from the page doesn't close and reopen the dialog.
  const onClose = useStableCallback(close);
  useEffect(() => {
    const dialog = dialogRef.current;
    const viewport = window.visualViewport;
    const sizeToViewport = () => {
      dialog.style.setProperty("--pf-search-viewport-height", `${viewport.height}px`);
      dialog.style.setProperty("--pf-search-viewport-top", `${viewport.offsetTop}px`);
    };
    if (viewport) sizeToViewport();
    viewport?.addEventListener("resize", sizeToViewport);
    viewport?.addEventListener("scroll", sizeToViewport);
    if (!dialog.open) dialog.showModal();
    // A click on the backdrop lands on the dialog itself (a pointer shortcut; Escape is the keyboard's).
    const onDown = (event) => {
      if (event.target === dialog) onClose();
    };
    dialog.addEventListener("mousedown", onDown);
    return () => {
      viewport?.removeEventListener("resize", sizeToViewport);
      viewport?.removeEventListener("scroll", sizeToViewport);
      dialog.removeEventListener("mousedown", onDown);
      dialog.close();
    };
  }, [onClose]);
  return (
    <dialog
      ref={dialogRef}
      className="pf-palette"
      aria-label="Search the docs"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}

/** The search field (a combobox) and its results (a listbox it points into). */
function PaletteSearch({ inputRef, query, items, cursor, setCursor, onQuery, onGo, onClose }) {
  const active = items[cursor];
  const onKeyDown = (e) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && active) onGo(active);
  };
  return (
    <>
      <div className="pf-palette-header">
        <input
          ref={inputRef}
          className="pf-palette-input"
          placeholder="Search docs, concepts, endpoints…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-label="Search"
          aria-expanded={items.length > 0}
          aria-controls="palette-results"
          aria-activedescendant={active ? optionId(active) : undefined}
          aria-autocomplete="list"
        />
        <button type="button" className="btn pf-palette-close" onClick={onClose}>Close</button>
      </div>
      <ul id="palette-results" className="pf-palette-list" role="listbox" aria-label="Results">
        {items.map((r, i) => (
          <li
            key={r.key}
            id={optionId(r)}
            role="option"
            tabIndex={-1}
            aria-selected={i === cursor}
            onMouseEnter={() => setCursor(i)}
            onClick={() => onGo(r)}
            onKeyDown={(e) => e.key === "Enter" && onGo(r)}
          >
            <span className="pf-palette-title">{r.title}</span>
            <span className="pf-palette-section">{r.section}</span>
            {r.snippet && <span className="pf-palette-snippet">…{r.snippet}…</span>}
          </li>
        ))}
        {items.length === 0 && <li className="pf-muted pf-palette-empty">No matches.</li>}
      </ul>
      <p className="pf-palette-foot"><kbd>↑↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close</p>
    </>
  );
}
