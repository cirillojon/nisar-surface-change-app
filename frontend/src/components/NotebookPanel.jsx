import { useState } from "react";

import { downloadText, findingLink, slugify, storyMarkdown } from "../services/notebook.js";

const dayFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmt = (iso) => (iso ? dayFmt.format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)) : "");

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** What the app showed when the finding was saved, in one line. */
function evidenceLine(f) {
  const e = f.evidence ?? {};
  const parts = [
    f.view?.name,
    e.label && e.display ? `${e.label} ${e.display}` : e.display ?? e.label,
    e.start && e.end && e.start !== e.end ? `${fmt(e.start)} – ${fmt(e.end)}` : fmt(e.date ?? e.start),
    f.view?.layerLabel,
  ].filter(Boolean);
  return parts.join(" · ");
}

function FindingItem({ f, stories, inStory, notebook, onShow, onOpenEvidence, onMove }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(f.title);
  const [notes, setNotes] = useState(f.notes ?? "");
  const [copied, setCopied] = useState(null);
  const link = findingLink(f);
  const e = f.evidence ?? {};
  const save = () => {
    notebook.updateFinding(f.id, { title: title.trim() || f.title, notes: notes.trim() });
    setEditing(false);
  };
  const others = stories.filter((s) => !s.findingIds.includes(f.id));
  return (
    <li className="note-item">
      <div className="note-head">
        {editing ? (
          <input className="note-title-input" value={title} onChange={(ev) => setTitle(ev.target.value)} aria-label="Title" />
        ) : (
          <strong className="note-title">{f.title}</strong>
        )}
        <span className="note-kind small">{f.kind === "moment" ? "Story moment" : "Map view"}</span>
      </div>
      <section className="note-yours" aria-label="Your notes">
        <p className="note-label">Your notes</p>
        {editing ? (
          <textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} rows={3} aria-label="Your notes" />
        ) : (
          <p className="small">{f.notes || <span className="muted">No notes yet.</span>}</p>
        )}
      </section>
      <section className="note-data" aria-label="From the data">
        <p className="note-label">From the data · app-generated</p>
        <p className="small">{evidenceLine(f) || "—"}</p>
        {e.caption && <p className="small muted">{e.caption}</p>}
        {e.footprint && <p className="small muted">{e.footprint}</p>}
        {e.mode && <p className="small muted">Acquisition mode {e.mode}</p>}
        <p className="small muted">Saved {fmt(f.createdAt)}{e.source ? ` · ${e.source}` : ""}</p>
      </section>
      <div className="note-actions">
        {editing ? (
          <>
            <button type="button" className="btn btn-small btn-primary" onClick={save}>Save</button>
            <button type="button" className="btn btn-small btn-secondary" onClick={() => { setEditing(false); setTitle(f.title); setNotes(f.notes ?? ""); }}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-small btn-primary" onClick={() => onShow(f)}>Show on map</button>
            <button type="button" className="btn btn-small btn-secondary" onClick={() => setEditing(true)}>Edit</button>
            {f.kind === "moment" && f.source?.slug && (
              <button type="button" className="btn btn-small btn-secondary" onClick={() => onOpenEvidence(f)}>Evidence card</button>
            )}
            {link && (
              <button
                type="button"
                className="btn btn-small btn-secondary"
                onClick={async () => {
                  setCopied((await copyText(link)) ? "ok" : "blocked");
                  window.setTimeout(() => setCopied(null), 1800);
                }}
              >
                {copied === "ok" ? "Copied ✓" : copied === "blocked" ? "Copy blocked" : "Copy link"}
              </button>
            )}
            {inStory ? (
              <>
                <button type="button" className="btn btn-small btn-secondary" aria-label="Move up" onClick={() => onMove(-1)}>↑</button>
                <button type="button" className="btn btn-small btn-secondary" aria-label="Move down" onClick={() => onMove(1)}>↓</button>
                <button type="button" className="btn btn-small btn-link" onClick={() => notebook.removeFromStory(inStory, f.id)}>
                  Take out of story
                </button>
              </>
            ) : (
              <>
                {others.length > 0 && (
                  <select
                    className="note-add"
                    value=""
                    aria-label={`Add “${f.title}” to a story`}
                    onChange={(ev) => ev.target.value && notebook.addToStory(ev.target.value, f.id)}
                  >
                    <option value="">Add to story…</option>
                    {others.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                )}
                <button
                  type="button"
                  className="btn btn-small btn-link"
                  onClick={() => window.confirm(`Delete “${f.title}”?`) && notebook.removeFinding(f.id)}
                >
                  Delete
                </button>
              </>
            )}
          </>
        )}
      </div>
    </li>
  );
}

function UserStory({ story, findings, notebook, onShow, onOpenEvidence }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(story.title);
  const [notes, setNotes] = useState(story.notes ?? "");
  const byId = new Map(findings.map((f) => [f.id, f]));
  const items = story.findingIds.map((id) => byId.get(id)).filter(Boolean);
  const save = () => {
    notebook.updateStory(story.id, { title: title.trim() || story.title, notes: notes.trim() });
    setEditing(false);
  };
  return (
    <section className="user-story" aria-label={story.title}>
      <div className="note-head">
        {editing ? (
          <input className="note-title-input" value={title} onChange={(ev) => setTitle(ev.target.value)} aria-label="Story title" />
        ) : (
          <h3>{story.title}</h3>
        )}
        <span className="note-kind small">Your story · {items.length} {items.length === 1 ? "finding" : "findings"}</span>
      </div>
      <section className="note-yours" aria-label="Your introduction">
        <p className="note-label">Your notes</p>
        {editing ? (
          <textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} rows={3} aria-label="Your introduction" />
        ) : (
          <p className="small">{story.notes || <span className="muted">No introduction yet.</span>}</p>
        )}
      </section>
      <div className="note-actions">
        {editing ? (
          <>
            <button type="button" className="btn btn-small btn-primary" onClick={save}>Save</button>
            <button type="button" className="btn btn-small btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-small btn-secondary" onClick={() => setEditing(true)}>Edit</button>
            <button
              type="button"
              className="btn btn-small btn-secondary"
              disabled={!items.length}
              onClick={() => downloadText(`${slugify(story.title)}.md`, storyMarkdown(story, findings))}
            >
              Export (Markdown)
            </button>
            <button
              type="button"
              className="btn btn-small btn-link"
              onClick={() => window.confirm(`Delete the story “${story.title}”? Its findings stay saved.`) && notebook.removeStory(story.id)}
            >
              Delete story
            </button>
          </>
        )}
      </div>
      {items.length ? (
        <ol className="note-list">
          {items.map((f) => (
            <FindingItem
              key={f.id}
              f={f}
              stories={notebook.stories}
              inStory={story.id}
              notebook={notebook}
              onShow={onShow}
              onOpenEvidence={onOpenEvidence}
              onMove={(step) => notebook.moveInStory(story.id, f.id, step)}
            />
          ))}
        </ol>
      ) : (
        <p className="small muted">Add saved findings with “Add to story…” below.</p>
      )}
    </section>
  );
}

/**
 * My findings: what the viewer saved and wrote, and the stories they
 * build from it. Separate from the curated stories, and labelled so the
 * viewer's notes are never mistaken for the app's analysis.
 */
export default function NotebookPanel({ notebook, onShow, onOpenEvidence }) {
  const [newTitle, setNewTitle] = useState("");
  const { findings, stories } = notebook;
  const create = (ev) => {
    ev.preventDefault();
    notebook.createStory(newTitle.trim() || "Untitled story");
    setNewTitle("");
  };
  return (
    <section className="notebook" aria-label="My findings" data-tour="notebook">
      <p className="small muted notebook-intro">
        Saved in this browser.
      </p>

      <h2 className="findings-heading">Your stories</h2>
      {stories.map((s) => (
        <UserStory key={s.id} story={s} findings={findings} notebook={notebook} onShow={onShow} onOpenEvidence={onOpenEvidence} />
      ))}
      <form className="notebook-new" onSubmit={create}>
        <input
          value={newTitle}
          onChange={(ev) => setNewTitle(ev.target.value)}
          placeholder="New story title"
          aria-label="New story title"
          maxLength={140}
        />
        <button type="submit" className="btn btn-small btn-secondary">Start a story</button>
      </form>

      <h2 className="findings-heading">Saved findings</h2>
      {findings.length ? (
        <ul className="note-list">
          {findings.map((f) => (
            <FindingItem
              key={f.id}
              f={f}
              stories={stories}
              inStory={null}
              notebook={notebook}
              onShow={onShow}
              onOpenEvidence={onOpenEvidence}
            />
          ))}
        </ul>
      ) : (
        <p className="small muted">
          Nothing saved yet. Open a place and press <strong>Save view</strong> above the map, or a story&apos;s{" "}
          <strong>Save / share</strong>.
        </p>
      )}
    </section>
  );
}
