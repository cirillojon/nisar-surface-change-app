import { useEffect, useId, useState } from "react";

import { absoluteApiUrl, fetchStory } from "../services/api.js";
import { STATUS_LABEL } from "../services/landchange.js";
import { footprintText } from "../services/chain.js";

const dayFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortDayFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
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

/** Keep the evidence and key caveat visible with the explanation. */
function Hypothesis({ h, moments, selectedDate, onMoment, imagePair, onCompareImages }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const about = (h.moments ?? []).map((i) => moments[i]).filter(Boolean);
  const canCompare = imagePair?.length === 2 && onCompareImages;
  const evidenceIntro = h.evidence_summary || firstSentence(h.consistent_with);
  const moreEvidence = h.evidence_summary ? h.consistent_with : h.consistent_with?.slice(evidenceIntro.length).trim();
  const caveat = h.caveat_summary || firstSentence(h.alternative);
  const moreCaveat = h.caveat_summary ? h.alternative : h.alternative?.slice(caveat.length).trim();
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
      {(about.length > 0 || canCompare) && (
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
          {canCompare && (
            <button
              type="button"
              className="story-moment"
              aria-label={`Compare ${span(...imagePair)} on the map`}
              onClick={() => onCompareImages(...imagePair)}
            >
              <span>Compare {shortDayFmt.formatRange(day(imagePair[0]), day(imagePair[1]))}</span>
            </button>
          )}
        </div>
      )}
      {caveat && <p className="hypothesis-caveat"><strong>Caveat</strong> {caveat}</p>}
      <div id={id} className="hypothesis-details" hidden={!open}>
        <dl>
          {moreEvidence && <div><dt>More evidence</dt><dd>{moreEvidence}</dd></div>}
          <div><dt>How it would work</dt><dd>{h.mechanism}</dd></div>
          {moreCaveat && moreCaveat !== caveat && <div><dt>More on the caveat</dt><dd>{moreCaveat}</dd></div>}
          <div><dt>Radar channel</dt><dd>{h.channel}</dd></div>
          <div><dt>How to test it</dt><dd>{h.test}</dd></div>
        </dl>
      </div>
    </li>
  );
}

function StoryEvidence({ story, selectedDate, onSelectDate, onCompareImages }) {
  const { saw } = story;
  if (story.source === "landchange" && saw?.suggested?.length >= 2 && onCompareImages) {
    const [from, to] = saw.suggested;
    return (
      <div className="story-lead" role="group" aria-label="Featured NISAR evidence">
        <p>{saw.headline}</p>
        <button type="button" className="story-evidence-action" onClick={() => onCompareImages(from, to)}>
          <span>Compare images</span><strong>{shortDayFmt.formatRange(day(from), day(to))}</strong>
        </button>
      </div>
    );
  }

  const lead = saw?.moments?.[story.hero_moment ?? 0];
  if (!lead?.display) return null;

  if (lead.readings?.length === 2) {
    return (
      <div className="story-lead" role="group" aria-label="Featured NISAR evidence">
        <p className="story-lead-label">{saw.label}</p>
        <div className="story-pass-pair">
          {lead.readings.map(({ date, display }) => (
            <button
              key={date}
              type="button"
              className="story-evidence-action story-pass"
              aria-label={`Show ${dayFmt.format(day(date))} on the map · ${display}`}
              aria-current={date === selectedDate || undefined}
              onClick={() => onSelectDate?.(date, lead.layer)}
            >
              <time dateTime={date}>{shortDayFmt.format(day(date))}</time>
              <strong>{display}</strong>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const isRate = lead.stat === "rate";
  const featured = isRate ? saw.moments.filter((m) => m.stat === "rate" && m.unit === lead.unit) : [lead];
  return (
    <div className="story-lead" role="group" aria-label="Featured NISAR evidence">
      <p className="story-lead-label">{saw.label}{isRate && " · fitted rates"}</p>
      {featured.map((m) => {
        const date = m.focus ?? m.end;
        const selected = isRate ? m.start <= selectedDate && selectedDate <= m.end : date === selectedDate;
        return (
          <button
            key={m.index}
            type="button"
            className="story-evidence-action"
            aria-label={`Show ${m.title} on the chart · ${m.display}`}
            aria-current={selected || undefined}
            onClick={() => onSelectDate?.(date, m.layer)}
          >
            <span>{isRate ? m.title : shortDayFmt.format(day(date))}</span><strong>{m.display}</strong>
          </button>
        );
      })}
    </div>
  );
}

/** Save / share for a story: the viewer's notebook, the evidence card, a brief, the data. */
function ShareMenu({ story, isSite, moment, open, onToggle, onSave, onOpenFinding }) {
  const [copied, setCopied] = useState(null);
  const query = moment != null ? `?moment=${moment}` : "";
  const copy = async () => {
    const link = `${window.location.origin}/workspace?mode=stories&finding=${encodeURIComponent(story.slug)}${moment != null ? `:${moment}` : ""}`;
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
        disabled={!story}
        aria-expanded={open}
        aria-controls="story-share-menu"
        onClick={onToggle}
      >
        Save / share
      </button>
      {story && open && (
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
 * One featured observation, possible explanations, and disclosures for
 * the full method and sources. The evidence actions select the map passes.
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
  onCompareImages,
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

  const heading = summary ?? story;
  const title = heading?.title ?? "Story";
  const isSite = story?.source === "site";
  const moments = story?.saw?.moments ?? [];
  const site = story?.site ?? {};
  // Only a place the gallery grades as unconfirmed needs flagging.
  const status = !isSite && story?.saw?.status !== "visible" ? story?.saw?.status : null;
  const dates = span(site.first_date, site.last_date);
  const radarRecord = isSite
    ? `${story.saw.label} (${story.saw.unit})`
    : [site.channels?.label, site.pixel_m ? `~${site.pixel_m} m pixels` : null].filter(Boolean).join(" · ");
  const fpText = isSite && story.saw?.metric === "water_pct" ? footprintText(story.saw.footprint) : null;
  const limits = story?.cant_see ?? [];
  const keyLimit = story?.key_limit || limits[0];

  // Save / share works on the moment being looked at, else the story's key one.
  const shown = moments.find((m) => m.end === selectedDate)
    ?? moments.find((m) => selectedDate && selectedDate >= m.start && selectedDate <= m.end);
  const momentIndex = isSite ? shown?.index ?? story.hero_moment ?? 0 : null;
  const moment = momentIndex == null ? null : moments[momentIndex];
  const ref = { slug, moment: momentIndex, title, label: moment ? `${moment.title} · ${moment.display}` : "Before & after" };
  const share = onShareToggle ? shareOpen : ownShareOpen;
  const toggleShare = onShareToggle ?? (() => setOwnShareOpen((v) => !v));

  // Keep the header and both action slots in place while the details load.
  const header = (
    <header className="story-head">
      <div className="story-head-row">
        {onBack && <button type="button" className="btn btn-link" onClick={onBack}>← All stories</button>}
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
      {heading && (
        <>
          <p className="story-eyebrow small">
            <span className={`story-theme-dot theme-${heading.theme}`} aria-hidden="true" />
            {heading.theme_label}
            {status && <span className={`badge land-badge-${status}`}>{STATUS_LABEL[status] ?? status}</span>}
          </p>
          <h2>{title}</h2>
        </>
      )}
      {story && (
        <>
          <StoryEvidence
            story={story}
            selectedDate={selectedDate}
            onSelectDate={onSelectDate}
            onCompareImages={onCompareImages}
          />
          {(site.scene_count || dates) && (
            <p className="story-record">
              {site.scene_count ? <span>{site.scene_count} {site.scene_count === 1 ? "pass" : "passes"}</span> : null}
              {site.scene_count && dates ? <span aria-hidden="true">·</span> : null}
              {dates && <span>{dates}</span>}
            </p>
          )}
          <p className="story-question">{story.question}</p>
          {keyLimit && <p className="story-main-limit">{keyLimit}</p>}
        </>
      )}
    </header>
  );

  if (!story) {
    return (
      <article className="story-panel" aria-label={title} aria-busy={!error}>
        {header}
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

  return (
    <article className="story-panel" aria-label={title}>
      {header}

      <section className="story-chapter" aria-labelledby="story-why-h">
        <div className="story-chapter-head">
          <h3 id="story-why-h">Possible explanations</h3>
          <span>Untested</span>
        </div>
        {story.hypotheses.length > 1 && <p className="small muted">Several explanations may apply.</p>}
        <ul className="hypotheses">
          {story.hypotheses.map((h) => (
            <Hypothesis
              key={h.id}
              h={h}
              moments={moments}
              selectedDate={selectedDate}
              onMoment={(m) => onSelectDate?.(m.focus ?? m.end, m.layer)}
              imagePair={isSite ? null : h.imagery_pair ?? story.saw?.suggested}
              onCompareImages={onCompareImages}
            />
          ))}
        </ul>
      </section>

      <details className="story-chapter story-about">
        <summary><h3>Method &amp; limits</h3></summary>
        <p>{story.place}</p>
        <p><strong>How radar sees it.</strong> {story.channel}</p>
        {radarRecord && <p className="small muted">{radarRecord}</p>}
        {fpText && <p className="small muted">{fpText}</p>}
        {limits.length > 0 && <ul className="story-limits">{limits.map((limit) => <li key={limit}>{limit}</li>)}</ul>}
      </details>

      <details className="story-chapter story-next">
        <summary><h3>Why it matters</h3></summary>
        <p>{story.next.application}</p>
        <p className="small muted"><strong>Not yet:</strong> it would take {lowerFirst(story.next.needs)}</p>
      </details>

      {children && (
        <details className="story-data">
          <summary>{isSite ? "Site notes & NISAR catalog" : "Image notes & sources"}</summary>
          {children}
        </details>
      )}
    </article>
  );
}
