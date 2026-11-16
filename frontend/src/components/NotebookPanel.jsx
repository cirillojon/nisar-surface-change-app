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

/**
 * Editing a title and notes: null while not editing, else the draft being
 * written, taken from the saved values when editing starts (so it is never a
 * stale copy of them).
 */
function useDraft(saved, onSave) {
  const [draft, setDraft] = useState(null);
  return {
    draft,
    editing: draft !== null,
    start: () => setDraft({ title: saved.title, notes: saved.notes ?? "" }),
    change: (field, value) => setDraft((d) => ({ ...d, [field]: value })),
    cancel: () => setDraft(null),
    save: () => {
      onSave({ title: draft.title.trim() || saved.title, notes: draft.notes.trim() });
      setDraft(null);
    },
  };
}

function CopyLinkButton({ link }) {
  const [copied, setCopied] = useState(null);
  const label = { ok: "Copied ✓", blocked: "Copy blocked" }[copied] ?? "Copy link";
  return (
    <button
      type="button"
      className="btn btn-small btn-secondary"
      onClick={async () => {
        setCopied((await copyText(link)) ? "ok" : "blocked");
        window.setTimeout(() => setCopied(null), 1800);
      }}
    >
      {label}
    </button>
  );
}

/** What the app showed when the finding was saved, kept apart from the viewer's notes. */
function FindingData({ f }) {
  const e = f.evidence ?? {};
  return (
    <section className="note-data" aria-label="From the data">
      <p className="note-label">From the data · app-generated</p>
      <p className="small">{evidenceLine(f) || "—"}</p>
      {e.caption && <p className="small muted">{e.caption}</p>}
      {e.footprint && <p className="small muted">{e.footprint}</p>}
      {e.mode && <p className="small muted">Acquisition mode {e.mode}</p>}
      <p className="small muted">Saved {fmt(f.createdAt)}{e.source ? ` · ${e.source}` : ""}</p>
    </section>
  );
}

/** Reorder or take out a finding in a story; add a loose one to a story, or delete it. */
function StoryActions({ f, stories, inStory, notebook, onMove }) {
  if (inStory) {
    return (
      <>
        <button type="button" className="btn btn-small btn-secondary" aria-label="Move up" onClick={() => onMove(-1)}>↑</button>
        <button type="button" className="btn btn-small btn-secondary" aria-label="Move down" onClick={() => onMove(1)}>↓</button>
        <button type="button" className="btn btn-small btn-link" onClick={() => notebook.removeFromStory(inStory, f.id)}>
          Take out of story
        </button>
      </>
    );
  }
  const others = stories.filter((s) => !s.findingIds.includes(f.id));
  return (
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
      <button type="button" className="btn btn-small btn-link" onClick={() => window.confirm(`Delete “${f.title}”?`) && notebook.removeFinding(f.id)}>
        Delete
      </button>
    </>
  );
}

function FindingActions({ f, editor, onShow, onOpenEvidence, story }) {
  if (editor.editing) {
    return (
      <>
        <button type="button" className="btn btn-small btn-primary" onClick={editor.save}>Save</button>
        <button type="button" className="btn btn-small btn-secondary" onClick={editor.cancel}>Cancel</button>
      </>
    );
  }
  const link = findingLink(f);
  return (
    <>
      <button type="button" className="btn btn-small btn-primary" onClick={() => onShow(f)}>Show on map</button>
      <button type="button" className="btn btn-small btn-secondary" onClick={editor.start}>Edit</button>
      {f.kind === "moment" && f.source?.slug && (
        <button type="button" className="btn btn-small btn-secondary" onClick={() => onOpenEvidence(f)}>Evidence card</button>
      )}
      {link && <CopyLinkButton link={link} />}
      <StoryActions f={f} {...story} />
    </>
  );
}

function FindingItem({ f, stories, inStory, notebook, onShow, onOpenEvidence, onMove }) {
  const editor = useDraft(f, (changes) => notebook.updateFinding(f.id, changes));
  const { draft } = editor;
  return (
    <li className="note-item">
      <div className="note-head">
        {draft ? (
          <input className="note-title-input" value={draft.title} onChange={(ev) => editor.change("title", ev.target.value)} aria-label="Title" />
        ) : (
          <strong className="note-title">{f.title}</strong>
        )}
        <span className="note-kind small">{f.kind === "moment" ? "Story moment" : "Map view"}</span>
      </div>
      <section className="note-yours" aria-label="Your notes">
        <p className="note-label">Your notes</p>
        {draft ? (
          <textarea value={draft.notes} onChange={(ev) => editor.change("notes", ev.target.value)} rows={3} aria-label="Your notes" />
        ) : (
          <p className="small">{f.notes || <span className="muted">No notes yet.</span>}</p>
        )}
      </section>
      <FindingData f={f} />
      <div className="note-actions">
        <FindingActions
          f={f}
          editor={editor}
          onShow={onShow}
          onOpenEvidence={onOpenEvidence}
          story={{ stories, inStory, notebook, onMove }}
        />
      </div>
    </li>
  );
}

function UserStory({ story, findings, notebook, onShow, onOpenEvidence }) {
  const editor = useDraft(story, (changes) => notebook.updateStory(story.id, changes));
  const { draft } = editor;
  const byId = new Map(findings.map((f) => [f.id, f]));
  const items = story.findingIds.map((id) => byId.get(id)).filter(Boolean);
  return (
    <section className="user-story" aria-label={story.title}>
      <div className="note-head">
        {draft ? (
          <input className="note-title-input" value={draft.title} onChange={(ev) => editor.change("title", ev.target.value)} aria-label="Story title" />
        ) : (
          <h3>{story.title}</h3>
        )}
        <span className="note-kind small">Your story · {items.length} {items.length === 1 ? "finding" : "findings"}</span>
      </div>
      <section className="note-yours" aria-label="Your introduction">
        <p className="note-label">Your notes</p>
        {draft ? (
          <textarea value={draft.notes} onChange={(ev) => editor.change("notes", ev.target.value)} rows={3} aria-label="Your introduction" />
        ) : (
          <p className="small">{story.notes || <span className="muted">No introduction yet.</span>}</p>
        )}
      </section>
      <div className="note-actions">
        {draft ? (
          <>
            <button type="button" className="btn btn-small btn-primary" onClick={editor.save}>Save</button>
            <button type="button" className="btn btn-small btn-secondary" onClick={editor.cancel}>Cancel</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-small btn-secondary" onClick={editor.start}>Edit</button>
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
