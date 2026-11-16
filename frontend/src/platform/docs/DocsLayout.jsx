import { MDXProvider } from "@mdx-js/react";
import { use, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Navigate, NavLink, useParams } from "react-router-dom";

import McpTools from "../api/McpTools.jsx";
import { useAssistant } from "../assistant/assistantStore.jsx";
import { AI_ENABLED } from "../features.js";
import { loadPage } from "./content.js";
import { mdxComponents } from "./mdx.jsx";
import { findPage, findTab, firstPageHref } from "./nav.js";

const TITLE = "NISAR Surface Change Explorer";
const REPO_EDIT = "https://github.com/cirillojon/nisar-surface-change-app/edit/main/frontend/src/content/docs";

function Sidebar({ tab, open, onNavigate }) {
  return (
    <nav className="pf-sidebar" aria-label={`${tab.label} pages`} data-open={open}>
      <p className="pf-sidebar-tab">{tab.label}</p>
      {tab.sections.map((section) => (
        <div key={section.title} className="pf-sidebar-section">
          <p className="pf-sidebar-heading">{section.title}</p>
          <ul>
            {section.pages.map((p) => (
              <li key={p.slug}>
                <NavLink
                  to={`/docs/${tab.id}/${p.slug}`}
                  className={({ isActive }) => `pf-sidebar-link${isActive ? " is-active" : ""}`}
                  onClick={onNavigate}
                >
                  {p.title}
                  {p.mcpTools && <span className="pf-sidebar-badge">MCP</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function useHeadings(articleRef, tabId, slug) {
  const [headings, setHeadings] = useState([]);
  const [active, setActive] = useState(null);
  useLayoutEffect(() => {
    const root = articleRef.current;
    if (!root) return undefined;
    const nodes = [...root.querySelectorAll("h2[id], h3[id]")];
    setHeadings(nodes.map((n) => ({ id: n.id, text: n.textContent.replace(/#$/, ""), level: n.tagName === "H3" ? 3 : 2 })));
    setActive(null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [articleRef, tabId, slug]);
  return { headings, active };
}

function PageBody({ tabId, page }) {
  if (page.mcpTools) return <McpTools />;
  const mod = use(loadPage(tabId, page.slug));
  if (!mod) {
    return (
      <>
        <h1>{page.title}</h1>
        <p className="pf-muted">This page hasn’t been written yet.</p>
      </>
    );
  }
  const { default: Content, meta = {} } = mod;
  return (
    <>
      <p className="pf-eyebrow">{page.section}</p>
      <h1>{meta.title ?? page.title}</h1>
      {meta.description && <p className="pf-lede">{meta.description}</p>}
      <Content components={mdxComponents} />
    </>
  );
}

export default function DocsLayout() {
  const { tabId, slug } = useParams();
  const tab = findTab(tabId);
  const found = tab && slug ? findPage(tabId, slug) : null;
  const articleRef = useRef(null);
  const [navOpen, setNavOpen] = useState(false);
  const { headings, active } = useHeadings(articleRef, tabId, slug);
  const { ask } = useAssistant();

  useEffect(() => {
    if (found) document.title = `${found.page.title} · ${tab.label} · ${TITLE}`;
  }, [found, tab]);

  if (!tab) return <Navigate to="/docs/get-started/what-is-nisar" replace />;
  if (!slug || !found) return <Navigate to={firstPageHref(tab)} replace />;
  const { page, prev, next } = found;
  const isReference = Boolean(page.mcpTools);

  return (
    <MDXProvider components={mdxComponents}>
      <div className={`pf-docs${isReference ? " pf-docs-wide" : ""}`}>
        <button
          type="button"
          className="pf-sidebar-toggle"
          aria-expanded={navOpen}
          onClick={() => setNavOpen((o) => !o)}
        >
          ☰ {tab.label}: {page.title}
        </button>
        <Sidebar tab={tab} open={navOpen} onNavigate={() => setNavOpen(false)} />
        <article className="pf-article" ref={articleRef}>
          <nav className="pf-breadcrumbs" aria-label="Breadcrumb">
            <Link to="/">Home</Link> <span aria-hidden="true">/</span>{" "}
            <Link to={firstPageHref(tab)}>{tab.label}</Link> <span aria-hidden="true">/</span>{" "}
            <span>{page.title}</span>
          </nav>
          <div className="pf-prose">
            <PageBody tabId={tabId} page={page} />
          </div>
          <div className="pf-page-foot">
            {AI_ENABLED ? (
              <button type="button" className="pf-askai-inline" onClick={() => ask(`Explain the key ideas on the "${page.title}" page in simple terms.`)}>
                <span aria-hidden="true">✦</span> Ask AI about this page
              </button>
            ) : <span />}
            {!isReference && (
              <a href={`${REPO_EDIT}/${tabId}/${page.slug}.mdx`} target="_blank" rel="noreferrer" className="pf-edit">
                Edit this page on GitHub
              </a>
            )}
          </div>
          <nav className="pf-pager" aria-label="Previous and next page">
            {prev ? (
              <Link to={`/docs/${tab.id}/${prev.slug}`} className="pf-pager-link">
                <span>← Previous</span>{prev.title}
              </Link>
            ) : <span />}
            {next ? (
              <Link to={`/docs/${tab.id}/${next.slug}`} className="pf-pager-link pf-pager-next">
                <span>Next →</span>{next.title}
              </Link>
            ) : <span />}
          </nav>
        </article>
        {!isReference && headings.length > 1 && (
          <aside className="pf-toc" aria-label="On this page">
            <p className="pf-toc-title">On this page</p>
            <ul>
              {/* Two embedded files can share a heading (e.g. "Frontend"), so ids can repeat. */}
              {headings.map((h, i) => (
                <li key={`${i}-${h.id}`} className={`pf-toc-l${h.level}${active === h.id ? " is-active" : ""}`}>
                  <a href={`#${h.id}`}>{h.text}</a>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </MDXProvider>
  );
}
