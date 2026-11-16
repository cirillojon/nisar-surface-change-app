import { useEffect, useId, useState } from "react";

import { absoluteApiUrl, fetchStory } from "../services/api.js";
import { STATUS_LABEL } from "../services/landchange.js";
import { footprintText } from "../services/chain.js";

const dayFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const day = (iso) => new Date(`${iso}T00:00:00Z`);
const span = (first, last) => first && last
  ? dayFmt.formatRange(day(first), day(last))
  : first || last ? dayFmt.format(day(first ?? last)) : "";
// "Several years…" → "several years…", but leave acronyms ("HV on every pass") alone.
const lowerFirst = (text = "") => (/^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);

/** The first sentence of a text (a sentence ends with . ! or ? before a capital). */
function firstSentence(text = "") {
  const [head] = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
  return head ?? text;
}

/**
 * Keep the evidence links and the main caveat visible while the viewer
 * compares explanations. The full reasoning opens from the heading.
 */
function Hypothesis({ h, moments, selectedDate, onMoment, onShowChange }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const about = (h.moments ?? []).map((i) => moments[i]).filter(Boolean);
  const caveat = firstSentence(h.alternative);
  const more = h.alternative.slice(caveat.length).trim();
  const evidenceIntro = about.length === 0 ? firstSentence(h.consistent_with) : "";
  return (
    <li className="hypothesis">
      <h4>
        <button
          type="button"
          className="hypothesis-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
        >
          {h.driver}
        </button>
      </h4>
      {evidenceIntro && <p className="hypothesis-observation">{evidenceIntro}</p>}
      {(about.length > 0 || onShowChange) && (
        <div className="hypothesis-moments" role="group" aria-label="Evidence on the map">
          {about.map((m) => (
            <button
              key={m.index}
              type="button"
              className="story-moment"
              aria-label={`Show ${m.title} on the map${m.display ? ` · ${m.display}` : ""}`}
              aria-current={Boolean(selectedDate && selectedDate === (m.focus ?? m.end)) || undefined}
              onClick={() => onMoment(m)}
            >
              <span>{m.title}</span>
              {m.display && <strong>{m.display}</strong>}
            </button>
          ))}
          {onShowChange && about.length === 0 && (
            <button type="button" className="story-moment" onClick={onShowChange}>
              Change map
            </button>
          )}
        </div>
      )}
      {caveat && <p className="hypothesis-caveat"><strong>Caveat</strong> {caveat}</p>}
      <dl id={id} className="hypothesis-details" hidden={!open}>
        {h.consistent_with !== evidenceIntro && (
          <div><dt>Evidence that fits</dt><dd>{h.consistent_with}</dd></div>
        )}
        <div><dt>How it would work</dt><dd>{h.mechanism}</dd></div>
        {more && <div><dt>Other caveats</dt><dd>{more}</dd></div>}
        <div><dt>Radar channel</dt><dd>{h.channel}</dd></div>
        <div><dt>How to test it</dt><dd>{h.test}</dd></div>
      </dl>
    </li>
  );
}

/** Save / share for a story: the viewer's notebook, the evidence card, a brief, the data. */
function ShareMenu({ story, isSite, moment, open, onToggle, onSave, onOpenFinding }) {
  const [copied, setCopied] = useState(null);
  const query = moment != null ? `?moment=${moment}` : "";
  const link = `${window.location.origin}/workspace?mode=stories&finding=${encodeURIComponent(story.slug)}${moment != null ? `:${moment}` : ""}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied("ok");
    } catch {
      setCopied("blocked");
    }
    window.setTimeout(() => setCopied(null), 1800);
  };
  return (
    <div className="story-share" data-tour="share">
      <button
        type="button"
        className="btn btn-small btn-secondary story-share-toggle"
        aria-expanded={open}
        aria-controls="story-share-menu"
        onClick={onToggle}
      >
        Save / share
      </button>
      {open && (
        <div id="story-share-menu" className="story-share-menu" role="group" aria-label="Save or share this story">
          {onSave && (
            <button type="button" className="btn btn-small btn-primary" data-tour="share-save" onClick={onSave}>
              Save to My findings…
            </button>
          )}
          <p className="small muted">The app&apos;s evidence for {isSite && moment != null ? "the moment on the map" : "this story"}:</p>
          <div className="finding-actions-row">
            {onOpenFinding && (
              <button type="button" className="btn btn-small btn-secondary" onClick={onOpenFinding}>
                Evidence card
              </button>
            )}
            <a className="btn btn-small btn-secondary" href={`/brief/${story.slug}${query}`} target="_blank" rel="noreferrer">
              Printable brief
            </a>
            {isSite && (
              <a className="btn btn-small btn-secondary" href={absoluteApiUrl(`/api/stories/${story.slug}/series.csv`)} download>
                CSV
              </a>
            )}
            <button type="button" className="btn btn-small btn-secondary" onClick={copy}>
              {copied === "ok" ? "Copied ✓" : copied === "blocked" ? "Copy blocked" : "Copy link"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Stories mode, details: the question a place raises, then what might
 * explain what NISAR shows there, what it can't show, and why it matters.
 *
 * The evidence is on the map and in the chart beside it, not repeated
 * here: hypotheses link to it ("Evidence on the map"). A gallery place's
 * notes (`children`) sit under the question; a site's notes and catalog
 * search (also `children`) are nested at the end.
 *
 * `summary` is the story's list entry: its heading shows at once, while
 * the rest loads.
 */
export default function StoryPanel({
  slug,
  summary = null,
  selectedDate,
  onSelectDate,
  onOpenFinding,
  onSave,
  onShowChange,
  shareOpen = false,
  onShareToggle,
  onBack,
  children,
}) {
  const [story, setStory] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [ownShareOpen, setOwnShareOpen] = useState(false);
  useEffect(() => {
    let live = true;
    setStory(null);
    setError(null);
    fetchStory(slug)
      .then((s) => live && setStory(s))
      .catch((e) => live && setError(e?.message || "Couldn't load the story."));
    return () => {
      live = false;
    };
  }, [slug, attempt]);

  if (!story) {
    return (
      <article className="story-panel" aria-label={summary?.title ?? "Story"} aria-busy={!error}>
        <header className="story-head">
          {onBack && <button type="button" className="btn btn-link" onClick={onBack}>← All stories</button>}
          {summary && (
            <>
              <p className="story-eyebrow small">
                <span className={`story-theme-dot theme-${summary.theme}`} aria-hidden="true" />
                {summary.theme_label}
              </p>
              <h2>{summary.title}</h2>
              <p className="story-question">{summary.question}</p>
            </>
          )}
        </header>
        {error ? (
          <p className="error" role="alert">
            {error}{" "}
            <button type="button" className="btn btn-link" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </p>
        ) : (
          <p className="muted" role="status">Loading the story…</p>
        )}
      </article>
    );
  }

  const isSite = story.source === "site";
  const moments = story.saw?.moments ?? [];
  const site = story.site ?? {};
  // Only a place the gallery grades as unconfirmed needs flagging.
  const status = !isSite && story.saw?.status !== "visible" ? story.saw?.status : null;
  const dates = span(site.first_date, site.last_date);
  const radarRecord = isSite
    ? `${story.saw.label} (${story.saw.unit})`
    : [site.channels?.label, site.pixel_m ? `~${site.pixel_m} m pixels` : null].filter(Boolean).join(" · ");
  const fpText = isSite && story.saw?.metric === "water_pct" ? footprintText(story.saw.footprint) : null;

  // Save / share works on the moment being looked at, else the story's key one.
  const shown = moments.find((m) => m.end === selectedDate)
    ?? moments.find((m) => selectedDate && selectedDate >= m.start && selectedDate <= m.end);
  const momentIndex = isSite ? shown?.index ?? story.hero_moment ?? 0 : null;
  const moment = momentIndex == null ? null : moments[momentIndex];
  const ref = { slug, moment: momentIndex, title: story.title, label: moment ? `${moment.title} · ${moment.display}` : "Before & after" };
  const share = onShareToggle ? shareOpen : ownShareOpen;
  const toggleShare = onShareToggle ?? (() => setOwnShareOpen((v) => !v));

  return (
    <article className="story-panel" aria-label={story.title}>
      <header className="story-head">
        <div className="story-head-row">
          <button type="button" className="btn btn-link" onClick={onBack}>← All stories</button>
          <ShareMenu
            story={story}
            isSite={isSite}
            moment={momentIndex}
            open={share}
            onToggle={toggleShare}
            onSave={onSave ? () => onSave({ story, moment, momentIndex }) : null}
            onOpenFinding={onOpenFinding ? () => onOpenFinding(ref) : null}
          />
        </div>
        <p className="story-eyebrow small">
          <span className={`story-theme-dot theme-${story.theme}`} aria-hidden="true" />
          {story.theme_label}
          {status && <span className={`badge land-badge-${status}`}>{STATUS_LABEL[status] ?? status}</span>}
        </p>
        <h2>{story.title}</h2>
        <p className="story-question">{story.question}</p>
        {(site.scene_count || dates) && (
          <p className="story-record">
            {site.scene_count ? <strong>{site.scene_count} passes</strong> : null}
            {dates && <span>{dates}</span>}
          </p>
        )}
        {!isSite && radarRecord && <p className="story-channel-summary small muted">{radarRecord}</p>}
      </header>

      {!isSite && children && (
        <section className="story-evidence" aria-label="What NISAR shows">{children}</section>
      )}

      <section className="story-chapter" aria-labelledby="story-why-h">
        <h3 id="story-why-h">Why might this be happening?</h3>
        <p className="story-uncertainty small muted">These explanations are untested, and several may apply.</p>
        <ul className="hypotheses">
          {story.hypotheses.map((h) => (
            <Hypothesis
              key={h.id}
              h={h}
              moments={moments}
              selectedDate={selectedDate}
              onMoment={(m) => onSelectDate?.(m.focus ?? m.end, m.layer)}
              onShowChange={isSite ? null : onShowChange}
            />
          ))}
        </ul>
      </section>

      <section className="story-chapter" aria-labelledby="story-cant-h">
        <h3 id="story-cant-h">What this can&apos;t show</h3>
        <ul className="story-limits">
          {story.cant_see.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </section>

      <details className="story-chapter story-about">
        <summary><h3>Place &amp; radar method</h3></summary>
        <p>{story.place}</p>
        <p><strong>How radar sees it.</strong> {story.channel}</p>
        {isSite && radarRecord && <p className="small muted">{radarRecord}</p>}
        {fpText && <p className="small muted">{fpText}</p>}
      </details>

      <details className="story-chapter story-next">
        <summary><h3>Why it matters</h3></summary>
        <p>{story.next.application}</p>
        <p className="small muted"><strong>Not yet:</strong> it would take {lowerFirst(story.next.needs)}</p>
      </details>

      {isSite && children && (
        <details className="story-data">
          <summary>Site notes &amp; NISAR catalog</summary>
          {children}
        </details>
      )}
    </article>
  );
}
