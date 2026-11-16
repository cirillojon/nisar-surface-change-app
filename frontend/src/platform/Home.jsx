import { Link } from "react-router-dom";

import HeroObservatory from "./HeroObservatory.jsx";
import { useAssistant } from "./assistant/assistantStore.jsx";
import { TABS, firstPageHref } from "./docs/nav.js";
import { AI_ENABLED } from "./features.js";
import { Icon } from "./icons.jsx";
import { workspaceHref } from "./workspaceContext.js";

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
            <Link to="/docs/get-started/what-is-nisar" className="pf-btn pf-btn-accent">What is NISAR?</Link>
            {AI_ENABLED && (
              <button type="button" className="pf-btn pf-btn-ghost" onClick={() => ask()}>
                <span aria-hidden="true">✦</span> Ask AI
              </button>
            )}
          </div>
        </div>
        <HeroObservatory />
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
        <div><strong>License</strong><span>Open source (Apache-2.0) · <a href="https://github.com/cirillojon/nisar-surface-change-app" target="_blank" rel="noreferrer">GitHub</a></span></div>
      </section>
    </div>
  );
}
