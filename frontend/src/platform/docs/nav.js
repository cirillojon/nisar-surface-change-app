/* The docs' information architecture: top-bar tabs and each tab's sidebar.
 *
 * A page lives at /docs/<tab.id>/<page.slug>. Ordinary pages are MDX files at
 * src/content/docs/<tab.id>/<page.slug>.mdx; `mcpTools` renders the live MCP
 * tool registry. Keep this file the single source for navigation.
 *
 * Sections marked `mcp` (the MCP server) or `ai` (the assistant API) are left
 * out when that feature is switched off (see ../features.js). */
import { AI_ENABLED, MCP_ENABLED } from "../features.js";

const ALL_TABS = [
  {
    id: "get-started",
    label: "Get Started",
    blurb: "NISAR in brief, how to use the map, and the limits.",
    sections: [
      {
        title: "Introduction",
        pages: [
          { slug: "what-is-nisar", title: "NISAR in brief" },
          { slug: "overview", title: "Overview" },
          { slug: "workspace", title: "Using the workspace" },
        ],
      },
      {
        title: "Reference",
        pages: [
          { slug: "faq", title: "Limits & FAQ" },
          { slug: "glossary", title: "Glossary" },
        ],
      },
    ],
  },
  {
    id: "science",
    label: "Radar Science",
    blurb: "How radar sees the ground, what HH and HV show, and how to reason about drivers.",
    sections: [
      {
        title: "Reading radar",
        pages: [
          { slug: "how-sar-works", title: "How radar sees Earth" },
          { slug: "polarization", title: "Polarization & backscatter" },
          { slug: "interferometry", title: "Interferometry (InSAR)" },
        ],
      },
      {
        title: "Interpreting change",
        pages: [
          { slug: "change-types", title: "Surface change & drivers" },
          { slug: "hypotheses", title: "Physical drivers & hypotheses" },
          { slug: "future-applications", title: "What NISAR could do next" },
        ],
      },
    ],
  },
  {
    id: "data",
    label: "Data & Methods",
    blurb: "The study sites, the NISAR products, the supporting data, and how every number is computed.",
    sections: [
      {
        title: "Places",
        pages: [{ slug: "study-sites", title: "Study sites & gallery" }],
      },
      {
        title: "Sources",
        pages: [
          { slug: "products", title: "NISAR products" },
          { slug: "supporting-data", title: "Supporting data" },
        ],
      },
      {
        title: "Methods",
        pages: [{ slug: "methods", title: "Data, methods & evidence" }],
      },
    ],
  },
  {
    id: "developers",
    label: "Developers",
    blurb: "Run it locally, how the data pipeline works, and how to deploy it.",
    sections: [
      {
        title: "Build",
        pages: [
          { slug: "local-setup", title: "Run it locally" },
          { slug: "architecture", title: "Architecture & data pipeline" },
          { slug: "automation", title: "NISAR Watch (automation)" },
          { slug: "deployment", title: "Deploy & troubleshoot" },
        ],
      },
      {
        mcp: true,
        title: "MCP server",
        pages: [
          { slug: "mcp", title: "What is MCP?" },
          { slug: "mcp-install", title: "Install the server" },
          { slug: "mcp-tools", title: "Tool reference", mcpTools: true },
          { slug: "mcp-examples", title: "Example conversations" },
        ],
      },
      {
        ai: true,
        title: "AI",
        pages: [{ slug: "assistant", title: "Assistant API" }],
      },
    ],
  },
];

export const TABS = ALL_TABS.map((tab) => ({
  ...tab,
  sections: tab.sections.filter((section) => (AI_ENABLED || !section.ai) && (MCP_ENABLED || !section.mcp)),
}));

export function findTab(tabId) {
  return TABS.find((t) => t.id === tabId) ?? null;
}

export function tabPages(tab) {
  return tab.sections.flatMap((s) => s.pages.map((p) => ({ ...p, section: s.title })));
}

export function findPage(tabId, slug) {
  const tab = findTab(tabId);
  if (!tab) return null;
  const pages = tabPages(tab);
  const index = pages.findIndex((p) => p.slug === slug);
  if (index < 0) return null;
  return { tab, page: pages[index], prev: pages[index - 1] ?? null, next: pages[index + 1] ?? null };
}

export function firstPageHref(tab) {
  return `/docs/${tab.id}/${tab.sections[0].pages[0].slug}`;
}

export function allPages() {
  return TABS.flatMap((tab) => tabPages(tab).map((p) => ({ ...p, tab })));
}
