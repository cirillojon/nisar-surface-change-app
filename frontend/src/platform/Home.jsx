import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { assetUrl, fetchSite, fetchSites } from "../services/api.js";
import { useAssistant } from "./assistant/assistantStore.jsx";
import { TABS, firstPageHref } from "./docs/nav.js";
import { AI_ENABLED } from "./features.js";
import { Icon } from "./icons.jsx";
import { workspaceHref } from "./workspaceContext.js";

const HERO_SITE = "sylhet-haor-floods";

const CHANGES = [
  { icon: "flood", title: "Floods & wetlands", body: "Open water in Bangladesh's haors: 53% of the box in July, 14% by November.", site: "sylhet-haor-floods" },
  { icon: "crop", title: "Crops & farming", body: "HV backscatter over Punjab's fields peaks in March and again in September.", site: "punjab-crop-cycles" },
  { icon: "subsidence", title: "Ground motion", body: "Mexico City: about 20 cm away from the satellite in a year, as sinking ground would read.", site: "mexico-city-subsidence" },
  { icon: "crop", title: "Irrigated fields", body: "Circular fields in the Columbia Basin darken from August to October.", site: "columbia-basin-crops" },
];

const QUESTIONS = [
  "What is NISAR and why does radar see through clouds?",
  "Why did Sylhet's open water shrink from July to November?",
  "Write Python that lists every study site and its date range",
];

function HeroTimelapse() {
  const [site, setSite] = useState(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchSites()
      .then((rows) => rows.find((s) => s.slug === HERO_SITE) ?? rows[0])
      .then((s) => (s ? fetchSite(s.id) : null))
      .then((s) => {
        if (!cancelled && s) setSite(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const scenes = useMemo(() => (site?.scenes ?? []).filter((s) => s.image_url), [site]);
  const water = useMemo(() => {
    const byDate = {};
    for (const o of site?.observations ?? []) {
      if (o.metric === "water_pct") byDate[o.observed_on] = o.value;
    }
    return byDate;
  }, [site]);

  useEffect(() => {
    if (!playing || scenes.length < 2) return undefined;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return undefined;
    const t = setInterval(() => setIndex((i) => (i + 1) % scenes.length), 1100);
    return () => clearInterval(t);
  }, [playing, scenes.length]);

  const scene = scenes[index];
  const pct = scene ? water[scene.date] : null;
  const maxPct = Math.max(1, ...Object.values(water));

  return (
    <figure className="pf-hero-visual">
      <div className="pf-hero-frame">
        {scenes.map((s, i) => (
          <img
            key={s.date}
            src={assetUrl(s.image_url)}
            alt={i === index ? `NISAR radar image of ${site.name} on ${s.date}` : ""}
            aria-hidden={i !== index}
            className={i === index ? "is-on" : ""}
            loading={i < 2 ? "eager" : "lazy"}
          />
        ))}
        {!scene && <div className="pf-hero-placeholder">NISAR radar time-lapse</div>}
        {scene && (
          <div className="pf-hero-hud">
            <span className="pf-hero-date">{scene.date}</span>
            {pct != null && <span className="pf-hero-pct">{pct.toFixed(1)}% open water</span>}
          </div>
        )}
      </div>
      {scenes.length > 1 && (
        <div className="pf-hero-strip" role="group" aria-label="Passes">
          <button type="button" className="pf-hero-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
            {playing ? "❚❚" : "▶"}
          </button>
          <div className="pf-hero-bars">
            {scenes.map((s, i) => (
              <button
                key={s.date}
                type="button"
                className={i === index ? "is-on" : ""}
                style={{ "--h": `${Math.max(8, ((water[s.date] ?? 0) / maxPct) * 100)}%` }}
                onClick={() => {
                  setIndex(i);
                  setPlaying(false);
                }}
                aria-label={`${s.date}${water[s.date] != null ? `, ${water[s.date].toFixed(1)}% open water` : ""}`}
              />
            ))}
          </div>
        </div>
      )}
      <figcaption>
        {scenes.length > 0
          ? `${site.name} · NISAR L-band radar · ${scenes.length} passes, ${scenes[0].date} to ${scenes[scenes.length - 1].date}. `
          : "Loading NISAR passes… "}
        <Link to={workspaceHref({ site: HERO_SITE })}>Explore it →</Link>
      </figcaption>
    </figure>
  );
}

export default function Home() {
  const { ask } = useAssistant();

  return (
    <div className="pf-home">
      <section className="pf-hero">
        <div className="pf-hero-text">
          <p className="pf-eyebrow">NASA–ISRO SAR mission · Open source</p>
          <h1>Watch Earth’s surface change through NISAR’s radar.</h1>
          <p className="pf-hero-lede">
            Floods, crops, ground motion, lava and ice at 16 places, through cloud and darkness. NISAR’s orbit
            repeats every 12 days; the passes shown are the ones delivered so far, 12 or more days apart.
          </p>
          <div className="pf-hero-ctas">
            <Link to="/workspace" className="pf-btn pf-btn-primary">Open the Workspace →</Link>
            <Link to="/docs/get-started/what-is-nisar" className="pf-btn pf-btn-accent">
              <Icon name="satellite" size={18} /> What is NISAR?
            </Link>
            {AI_ENABLED && (
              <button type="button" className="pf-btn pf-btn-ghost" onClick={() => ask()}>
                <span aria-hidden="true">✦</span> Ask AI
              </button>
            )}
          </div>
        </div>
        <HeroTimelapse />
      </section>

      <section className="pf-home-section">
        <h2>What NISAR sees</h2>
        <p className="pf-home-sub">Each opens in the map.</p>
        <div className="pf-changes">
          {CHANGES.map((c) => (
            <Link key={c.title} to={workspaceHref({ mode: "stories", site: c.site })} className="pf-change">
              <Icon name={c.icon} size={22} />
              <span className="pf-change-title">{c.title}</span>
              <span className="pf-change-body">{c.body}</span>
            </Link>
          ))}
          <Link to="/docs/data/study-sites#land-change-gallery" className="pf-change pf-change-more">
            <Icon name="volcano" size={22} />
            <span className="pf-change-title">+ the land-change gallery</span>
            <span className="pf-change-body">Eruptions, glaciers, floods and landslides, graded by how clearly NISAR shows them.</span>
          </Link>
        </div>
      </section>

      <section className="pf-home-section">
        <h2>Read the docs</h2>
        <p className="pf-home-sub">The science, the data and the limits behind the map.</p>
        <div className="pf-audiences">
          {TABS.map((tab) => (
            <Link key={tab.id} to={firstPageHref(tab)} className="pf-card pf-audience">
              <span className="pf-card-icon"><Icon name={tab.icon} /></span>
              <span className="pf-card-title">{tab.label} <span aria-hidden="true">→</span></span>
              <span className="pf-card-body">{tab.blurb}</span>
            </Link>
          ))}
        </div>
      </section>

      {AI_ENABLED && (
        <section className="pf-home-section pf-home-ai">
          <div>
            <p className="pf-eyebrow">AI assistant</p>
            <h2>Ask anything, get answers grounded in the data</h2>
            <p>
              The assistant uses this platform’s own tools and docs: it pulls real measurements, cites the page
              it learned from, writes API calls and opens the map where it matters. It’s available on every
              page, including the workspace.
            </p>
          </div>
          <ul className="pf-suggestions pf-suggestions-lg">
            {QUESTIONS.map((q) => (
              <li key={q}>
                <button type="button" onClick={() => ask(q)}><span aria-hidden="true">✦</span> {q}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="pf-home-section pf-trust">
        <div><strong>Data</strong><span>NISAR L2/L3 products from NASA’s ASF DAAC, via NASA CMR</span></div>
        <div><strong>Status</strong><span>NISAR products are provisional until reprocessing ends</span></div>
        <div><strong>Methods</strong><span><Link to="/docs/data/methods">Every number’s source and limits</Link></span></div>
        <div><strong>License</strong><span>Open source (MIT) · <a href="https://github.com/cirillojon/nisar-surface-change" target="_blank" rel="noreferrer">GitHub</a></span></div>
      </section>
    </div>
  );
}
