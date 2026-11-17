/* Components available inside every docs MDX page (no import needed). */
import { useQuery } from "@tanstack/react-query";
import { Children, isValidElement } from "react";
import { Link } from "react-router-dom";

import { NisarIllustration, SarDiagram } from "../../components/tour/Illustrations.jsx";
import { landChangeQuery, sitesQuery, storiesQuery } from "../../services/queries.js";
import { STATUS_LABEL } from "../../services/landchange.js";
import { useAssistant } from "../assistant/assistantStore.jsx";
import { TryIt } from "../api/Endpoint.jsx";
import { operationById } from "../api/spec.js";
import { AI_ENABLED, isAiHref } from "../features.js";
import { Icon } from "../icons.jsx";
import { workspaceHref } from "../workspaceContext.js";
import CodeBlock from "./CodeBlock.jsx";

const REPO = "https://github.com/cirillojon/nisar-surface-change-app/blob/main";

function slugify(node) {
  const text = typeof node === "string" ? node : Children.toArray(node).map((c) =>
    typeof c === "string" ? c : isValidElement(c) ? slugify(c.props.children) : "").join("");
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** A heading with an id and a # link to it. */
function Heading({ as: Tag, children, ...props }) {
  const id = props.id ?? slugify(children);
  return (
    <Tag id={id} {...props}>
      {children}
      <a className="pf-anchor" href={`#${id}`} aria-label="Link to this section">#</a>
    </Tag>
  );
}
export function H2(props) {
  return <Heading as="h2" {...props} />;
}
export function H3(props) {
  return <Heading as="h3" {...props} />;
}

export function SmartLink({ href = "", children, ...props }) {
  // A link to a switched-off AI page reads as plain text.
  if (isAiHref(href)) return <>{children}</>;
  // Repo docs link to each other as relative .md files: send those to GitHub.
  if (/^(\.\.?\/)?[\w./-]+\.md(#.*)?$/.test(href) && !href.startsWith("http")) {
    const clean = href.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
    const path = clean.startsWith("docs/") || clean.includes("/") ? clean : `docs/${clean}`;
    return <a href={`${REPO}/${path}`} target="_blank" rel="noreferrer" {...props}>{children}</a>;
  }
  if (href.startsWith("/") && !href.startsWith("/api/")) return <Link to={href} {...props}>{children}</Link>;
  // Other relative paths come from repo docs (e.g. ../scripts/extract_nisar.py).
  if (!/^(https?:|#|mailto:|\/)/.test(href)) {
    const clean = href.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
    return <a href={`${REPO}/${clean}`} target="_blank" rel="noreferrer" {...props}>{children}</a>;
  }
  if (/^https?:/.test(href)) return <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>;
  return <a href={href} {...props}>{children}</a>;
}

export function Pre({ children }) {
  const child = Children.only(children);
  const className = child?.props?.className ?? "";
  const lang = className.replace("language-", "") || "text";
  const code = String(child?.props?.children ?? "").replace(/\n$/, "");
  return <CodeBlock code={code} language={lang} />;
}

export function Table(props) {
  return (
    // Focusable so keyboard users can scroll wide tables.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="pf-table-wrap" tabIndex={0} role="region" aria-label="Table"><table {...props} /></div>
  );
}

const ART = { nisar: NisarIllustration, radar: SarDiagram };

/** One of the welcome dialog's illustrations, with a caption. */
export function Art({ name, children }) {
  const Svg = ART[name];
  if (!Svg) return null;
  return (
    <figure className="pf-art">
      <Svg />
      {children && <figcaption>{children}</figcaption>}
    </figure>
  );
}

export function Callout({ type = "info", title, children }) {
  return (
    <div className={`pf-callout pf-callout-${type}`}>
      {title && <strong className="pf-callout-title">{title}</strong>}
      {children}
    </div>
  );
}

export function Cards({ children, cols = 2 }) {
  return <div className={`pf-cards pf-cards-${cols}`}>{children}</div>;
}

export function Card({ to, icon, title, children }) {
  if (isAiHref(to)) return null;
  const inner = (
    <>
      {icon && <span className="pf-card-icon"><Icon name={icon} /></span>}
      <span className="pf-card-title">{title} <span aria-hidden="true">→</span></span>
      <span className="pf-card-body">{children}</span>
    </>
  );
  return to?.startsWith("http")
    ? <a className="pf-card" href={to} target="_blank" rel="noreferrer">{inner}</a>
    : <Link className="pf-card" to={to}>{inner}</Link>;
}

export function OpenInWorkspace({ mode, site, place, finding, date, children }) {
  return (
    <Link className="pf-open-ws" to={workspaceHref({ mode, site, place, finding, date })}>
      <Icon name="map" size={16} /> {children ?? "Open in the workspace"} <span aria-hidden="true">→</span>
    </Link>
  );
}

/** Shows its children only while the AI features are switched on. */
export function AIOnly({ children }) {
  return AI_ENABLED ? <>{children}</> : null;
}

export function AskAI({ prompt, children }) {
  const { ask } = useAssistant();
  if (!AI_ENABLED) return null;
  return (
    <button type="button" className="pf-askai-inline" onClick={() => ask(prompt)}>
      <span aria-hidden="true">✦</span> {children ?? prompt}
    </button>
  );
}

export function ApiTry({ op }) {
  const operation = operationById(op);
  if (!operation) return <Callout type="warn">Unknown operation {op}</Callout>;
  return <div className="pf-apitry"><TryIt operation={operation} /></div>;
}

/** Live table of study sites from /api/sites. */
export function SiteTable() {
  const { data: sites, isError } = useQuery(sitesQuery());
  if (isError || sites?.length === 0) return <Callout type="warn">Couldn’t load the sites. Is the backend running?</Callout>;
  if (!sites) return <p className="pf-muted" role="status">Loading sites…</p>;
  return (
    <Table>
      <thead><tr><th>Site</th><th>Change</th><th>Product</th><th>Passes</th><th>Record</th><th /></tr></thead>
      <tbody>
        {sites.map((s) => (
          <tr key={s.id}>
            <td>{s.name}</td>
            <td>{s.change_type.replace("_", " & ")}</td>
            <td><code>{s.product}</code></td>
            <td>{s.scene_count}</td>
            <td>{s.first_date} → {s.last_date}</td>
            <td><Link to={workspaceHref({ site: s.slug })}>Open →</Link></td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Live list of the land-change gallery from /api/landchange. */
export function LandChangeTable() {
  const { data, isError } = useQuery(landChangeQuery());
  if (isError || data?.sites?.length === 0) return <Callout type="warn">Couldn’t load the gallery. Is the backend running?</Callout>;
  if (!data) return <p className="pf-muted" role="status">Loading the gallery…</p>;
  return (
    <Table>
      <thead><tr><th>Place</th><th>Kind</th><th>Region</th><th>What happened</th><th>In NISAR so far</th><th>Passes</th></tr></thead>
      <tbody>
        {data.sites.map((s) => (
          <tr key={s.slug}>
            <td>{s.name}</td>
            <td>{s.kind}</td>
            <td>{s.region}</td>
            <td>{s.headline}</td>
            <td>{STATUS_LABEL[s.status] ?? "—"}</td>
            <td>{s.passes?.length ?? 0}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Live list of the workspace's stories from /api/stories (optionally one theme). */
export function StoryTable({ theme }) {
  const { data, isError } = useQuery(storiesQuery());
  const rows = (data?.stories ?? []).filter((s) => !theme || s.theme === theme);
  if (isError || (data && !rows.length)) return <Callout type="warn">Couldn’t load the stories. Is the backend running?</Callout>;
  if (!data) return <p className="pf-muted" role="status">Loading stories…</p>;
  const label = Object.fromEntries((data.themes ?? []).map((t) => [t.id, t.label]));
  return (
    <Table>
      <thead><tr><th>Story</th><th>Theme</th><th>The question</th><th /></tr></thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.slug}>
            <td>{s.title}</td>
            <td>{label[s.theme] ?? s.theme}</td>
            <td>{s.question}</td>
            <td>
              <Link to={workspaceHref({ mode: "stories", [s.source === "site" ? "site" : "place"]: s.slug })}>Open →</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
