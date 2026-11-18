import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import HeroObservatory from "./HeroObservatory.jsx";
import HeroEarth from "./HeroEarth.jsx";
import HomeCoverage from "./HomeCoverage.jsx";
import { useAssistant } from "./assistant/assistantStore.jsx";
import { TABS, firstPageHref } from "./docs/nav.js";
import { AI_ENABLED } from "./features.js";
import getStartedArt from "./media/docs-get-started.webp";
import radarScienceArt from "./media/docs-radar-science.webp";
import dataMethodsArt from "./media/docs-data-methods-complete.webp";
import developersArt from "./media/docs-developers.webp";

const DOC_CARDS = {
  "get-started": {
    art: { src: getStartedArt, width: 574, height: 344 },
  },
  science: {
    art: { src: radarScienceArt, width: 1400, height: 555 },
  },
  data: {
    art: { src: dataMethodsArt, width: 800, height: 579 },
  },
  developers: {
    art: { src: developersArt, width: 1234, height: 824 },
    title: "For Developers",
  },
};

const QUESTIONS = [
  "What is NISAR and why does radar see through clouds?",
  "Why did Sylhet's open water shrink from July to November?",
  "Write Python that lists every study site and its date range",
];

export default function Home() {
  const { ask } = useAssistant();
  const [landing, setLanding] = useState(null);

  return (
    <div className="pf-home">
      <div className="pf-hero-track">
        <section className="pf-hero">
          <div className="pf-hero-text">
            <h1>Watch Earth’s surface change through NISAR’s radar.</h1>
            <p className="pf-hero-lede">
              Track floods, crops, ground motion, lava, and ice across the globe, even through clouds and darkness.
            </p>
            <div className="pf-hero-ctas">
              <Link to="/workspace" className="pf-btn pf-btn-primary">Open the Workspace →</Link>
              <Link to="/docs/get-started/what-is-nisar" className="pf-btn pf-btn-secondary">What is NISAR?</Link>
              {AI_ENABLED && (
                <button type="button" className="pf-btn pf-btn-ghost" onClick={() => ask()}>
                  <span aria-hidden="true">✦</span> Ask AI
                </button>
              )}
            </div>
          </div>
          <HeroObservatory />
          <HeroEarth landing={landing} />
        </section>
      </div>

      <HomeCoverage onLandingChange={setLanding} />

      <section className="pf-home-section pf-home-docs" id="read-the-docs" aria-labelledby="pf-home-docs-title">
        <h2 id="pf-home-docs-title">Read the docs</h2>
        <p className="pf-home-sub">The science, the data and the limits behind the map.</p>
        <div className="pf-home-docs-grid">
          {TABS.map((tab) => {
            const { art, title = tab.label } = DOC_CARDS[tab.id] ?? {};
            const titleId = `pf-doc-card-${tab.id}-title`;
            const descriptionId = `pf-doc-card-${tab.id}-description`;
            return (
              <Link key={tab.id} to={firstPageHref(tab)} className="pf-doc-card" data-topic={tab.id}
                aria-labelledby={titleId} aria-describedby={descriptionId}>
                <div className="pf-doc-card-copy">
                  <h3 id={titleId}>{title}</h3>
                  <p id={descriptionId}>{tab.blurb}</p>
                </div>
                <div className="pf-doc-card-art" aria-hidden="true">
                  {art && <img {...art} alt="" loading="lazy" decoding="async" />}
                </div>
                <div className="pf-doc-card-footer" aria-hidden="true">
                  <span className="pf-doc-card-arrow"><ArrowUpRight size={23} /></span>
                </div>
              </Link>
            );
          })}
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
