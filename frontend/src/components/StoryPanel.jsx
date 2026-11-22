import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import { absoluteApiUrl } from "../services/api.js";
import { storyQuery } from "../services/queries.js";
import { STATUS_LABEL } from "../services/landchange.js";
import { footprintText } from "../services/chain.js";
import { LandChangeCallout } from "./LandChangePanel.jsx";

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

const signed = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}`;
const METRIC_LABEL = { hh_db: "HH", hv_db: "HV", water_pct: "open water" };
// The numbers NISAR Watch measured, by detector field; fields not listed aren't shown.
const DETECTION_ROWS = [
  ["metric", "Measured in", (v) => METRIC_LABEL[v] ?? v],
  ["days_apart", "Passes compared", (v, c) => `${dayFmt.format(day(c.start))} and ${dayFmt.format(day(c.end))} (${v} days apart)`],
  ["area_km2", "Changed patch", (v, c) => `${v} km²${c.offset_km != null ? `, ${c.direction === "centre" ? "at the centre" : `${c.offset_km} km ${c.direction} of the centre`}` : ""}`],
  ["mean_change_db", "Average change", (v, c) => `${signed(v)} dB${c.direction_db ? ` (${c.direction_db})` : ""}`],
  ["change", "Step", (v, c) => `${c.before} → ${c.after} ${c.unit} (${signed(v)}; usual noise ${c.noise})`],
  ["rate_per_month", "Pace", (v, c) => `${signed(v)} ± ${c.se_per_month} ${c.unit} a month over ${c.passes} passes (R² ${c.r2})`],
  ["held_share", "Still there on the next pass", (v, c) => `${Math.round(v * 100)}%${c.held_on ? ` on ${dayFmt.format(day(c.held_on))}` : ""}`],
  ["usual_patch_px", "Usual largest patch", (v, c) => `${v} px in ${c.pairs} pairs (this one: ${c.patch_px} px)`],
];

/** An auto-detected story: who found it, that no one reviewed it, and the measured numbers. */
function AutoDetection({ story }) {
  const c = story.detection ?? {};
  const rows = DETECTION_ROWS.filter(([key]) => c[key] != null);
  const ev = story.event;
  const updated = story.updated_at && story.updated_at !== story.detected_at;
  return (
    <>
      <div className="story-auto-note small" role="note">
        <p>
          <strong>Found by NISAR Watch</strong>
          {story.detected_at && <> on {dayFmt.format(day(story.detected_at))}</>}
          {updated && <> (updated {dayFmt.format(day(story.updated_at))})</>}.
          {" "}No person has reviewed it: the numbers are measured; what caused the change is not known.
        </p>
        {ev && (
          <p>
            Reported nearby: {ev.url ? <a href={ev.url} target="_blank" rel="noreferrer">{ev.title}</a> : ev.title}
            {ev.date && <> ({dayFmt.format(day(ev.date))}, {ev.source})</>}. Shown for context; the radar alone
            doesn&apos;t show what drove the change.
          </p>
        )}
      </div>
      {story.summary && <p className="story-summary">{story.summary}</p>}
      {rows.length > 0 && (
        <dl className="story-detection small">
          {rows.map(([key, label, fmt]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{fmt(c[key], c)}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
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

function StoryEvidence({ story, selectedDate, onSelectDate, onCompareImages, activeChangePair }) {
  const { saw } = story;
  if (story.source === "landchange" && saw?.look_for) {
    const [from, to] = saw.suggested ?? [];
    const changeShown = activeChangePair?.from === from && activeChangePair?.to === to && Boolean(from && to);
    const toggleChange = from && to && onCompareImages
      ? () => onCompareImages(from, to, changeShown ? null : "change")
      : null;
    return (
      <div className="story-lead story-image-evidence" role="group" aria-label="Featured NISAR evidence">
        <LandChangeCallout lookFor={saw.look_for} changeShown={changeShown} onToggleChange={toggleChange} />
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

/** The moment Save / share works on: the one being looked at, else the story's key one. */
function shownMoment(story, selectedDate) {
  const moments = story?.saw?.moments ?? [];
  if (story?.source !== "site") return { index: null, moment: null };
  const shown = moments.find((m) => m.end === selectedDate)
    ?? moments.find((m) => selectedDate && selectedDate >= m.start && selectedDate <= m.end);
  const index = shown?.index ?? story.hero_moment ?? 0;
  return { index, moment: moments[index] ?? null };
}

/** What the record behind a story is: the series it charts, or its image channels and pixel size. */
function radarRecord(story) {
  if (story.source === "site") return `${story.saw.label} (${story.saw.unit})`;
  const site = story.site ?? {};
  return [site.channels?.label, site.pixel_m ? `~${site.pixel_m} m pixels` : null].filter(Boolean).join(" · ");
}

/** "12 passes · Jun 20 – Nov 11, 2026", as much of it as is known. */
function StoryRecord({ site }) {
  const dates = span(site.first_date, site.last_date);
  if (!site.scene_count && !dates) return null;
  return (
    <p className="story-record">
      {site.scene_count ? <span>{site.scene_count} {site.scene_count === 1 ? "pass" : "passes"}</span> : null}
      {site.scene_count && dates ? <span aria-hidden="true">·</span> : null}
      {dates && <span>{dates}</span>}
    </p>
  );
}

/** The story's theme and title (from its list entry until it loads), and a gallery place's grade. */
function StoryTitle({ heading, title, story }) {
  if (!heading) return null;
  // Only a place the gallery grades as unconfirmed needs flagging.
  const status = story && story.source !== "site" && story.saw?.status !== "visible" ? story.saw?.status : null;
  return (
    <>
      <p className="story-eyebrow small">
        <span className={`story-theme-dot theme-${heading.theme}`} aria-hidden="true" />
        {heading.theme_label}
        {status && <span className={`badge land-badge-${status}`}>{STATUS_LABEL[status] ?? status}</span>}
      </p>
      <h2>{title}</h2>
    </>
  );
}

/** The story's lead: its featured evidence, record, question and main limit. */
function StoryLead({ story, selectedDate, onSelectDate, onCompareImages, activeChangePair }) {
  const keyLimit = story.key_limit || story.cant_see?.[0];
  return (
    <>
      <StoryEvidence
        story={story}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        onCompareImages={onCompareImages}
        activeChangePair={activeChangePair}
      />
      <StoryRecord site={story.site ?? {}} />
      <p className="story-question">{story.question}</p>
      {keyLimit && <p className="story-main-limit">{keyLimit}</p>}
    </>
  );
}

function Hypotheses({ story, selectedDate, onSelectDate, onCompareImages }) {
  const isSite = story.source === "site";
  const moments = story.saw?.moments ?? [];
  return (
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
  );
}

function MethodAndLimits({ story }) {
  const record = radarRecord(story);
  const fpText = story.source === "site" && story.saw?.metric === "water_pct" ? footprintText(story.saw.footprint) : null;
  const limits = story.cant_see ?? [];
  return (
    <details className="story-chapter story-about">
      <summary><h3>Method &amp; limits</h3></summary>
      <p>{story.place}</p>
      <p><strong>How radar sees it.</strong> {story.channel}</p>
      {record && <p className="small muted">{record}</p>}
      {fpText && <p className="small muted">{fpText}</p>}
      {limits.length > 0 && <ul className="story-limits">{limits.map((limit) => <li key={limit}>{limit}</li>)}</ul>}
    </details>
  );
}

function WhyItMatters({ next }) {
  return (
    <details className="story-chapter story-next">
      <summary><h3>Why it matters</h3></summary>
      <p>{next.application}</p>
      <p className="small muted"><strong>Not yet:</strong> it would take {lowerFirst(next.needs)}</p>
    </details>
  );
}

/** While the story loads, or why it couldn't. */
function StoryPending({ error, onRetry }) {
  if (!error) return <p className="muted" role="status">Loading the story…</p>;
  return (
    <p className="error" role="alert">
      {error.message || "Couldn't load the story."}{" "}
      <button type="button" className="btn btn-link" onClick={onRetry}>Try again</button>
    </p>
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
  activeChangePair = null,
  shareOpen = false,
  onShareToggle,
  onBack,
  children,
}) {
  const { data: story, error, refetch } = useQuery(storyQuery(slug));
  const [ownShareOpen, setOwnShareOpen] = useState(false);
  const heading = summary ?? story;
  const title = heading?.title ?? "Story";
  const isSite = story?.source === "site";
  const { index: momentIndex, moment } = shownMoment(story, selectedDate);
  const isAuto = story?.origin === "auto";
  const ref = { slug, moment: momentIndex, title, label: moment ? `${moment.title} · ${moment.display}` : "Before & after" };

  // Keep the header and both action slots in place while the details load.
  const header = (
    <header className="story-head">
      <div className="story-head-row">
        {onBack && <button type="button" className="btn btn-link" onClick={onBack}>← All stories</button>}
        <ShareMenu
          story={story}
          isSite={isSite}
          moment={momentIndex}
          open={onShareToggle ? shareOpen : ownShareOpen}
          onToggle={onShareToggle ?? (() => setOwnShareOpen((v) => !v))}
          onSave={onSave ? () => onSave({ story, moment, momentIndex }) : null}
          onOpenFinding={onOpenFinding ? () => onOpenFinding(ref) : null}
        />
      </div>
      <StoryTitle heading={heading} title={title} story={story} />
      {story && (
        <StoryLead
          story={story}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          onCompareImages={onCompareImages}
          activeChangePair={activeChangePair}
        />
      )}
    </header>
  );

  if (!story) {
    return (
      <article className="story-panel" aria-label={title} aria-busy={!error}>
        {header}
        <StoryPending error={error} onRetry={() => refetch()} />
      </article>
    );
  }

  return (
    <article className="story-panel" aria-label={title}>
      {header}
      {isAuto && (
        <section className="story-chapter" aria-labelledby="story-measured-h">
          <div className="story-chapter-head">
            <h3 id="story-measured-h">What was measured</h3>
            <span>Not reviewed</span>
          </div>
          <AutoDetection story={story} />
        </section>
      )}
      {(!isAuto || story.hypotheses.length > 0) && (
        <Hypotheses story={story} selectedDate={selectedDate} onSelectDate={onSelectDate} onCompareImages={onCompareImages} />
      )}
      <MethodAndLimits story={story} />
      <WhyItMatters next={story.next} />
      {children && (
        <details className="story-data">
          <summary>{isSite ? "Site notes & NISAR catalog" : "Image notes & sources"}</summary>
          {children}
        </details>
      )}
    </article>
  );
}
