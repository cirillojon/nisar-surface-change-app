import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import App from "../App.jsx";
import { codeSamples, operationById, operations } from "../platform/api/spec.js";
import * as docs from "../platform/docs/content.js";
import { TABS, allPages, findPage } from "../platform/docs/nav.js";
import Markdown from "../platform/assistant/Markdown.jsx";
import { AssistantProvider } from "../platform/assistant/assistantStore.jsx";
import TopBar from "../platform/TopBar.jsx";
import { workspaceHref } from "../platform/workspaceContext.js";
import * as api from "../services/api.js";

describe("<TopBar />", () => {
  it("marks the current workspace without an opening arrow and keeps global actions usable", () => {
    const onSearch = vi.fn();
    render(
      <MemoryRouter initialEntries={["/workspace"]}>
        <AssistantProvider>
          <TopBar inWorkspace onSearch={onSearch} />
        </AssistantProvider>
      </MemoryRouter>,
    );
    const workspace = screen.getByRole("link", { name: "Workspace" });
    expect(workspace).toHaveAttribute("aria-current", "page");
    expect(workspace).toHaveTextContent(/^Workspace$/);
    const nav = within(screen.getByRole("banner")).getByRole("navigation", { name: "Main navigation" });
    expect(within(nav).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/",
      "/docs/get-started/what-is-nisar",
      "/docs/science/how-sar-works",
      "/docs/data/study-sites",
      "/docs/developers/local-setup",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Search documentation" }));
    expect(onSearch).toHaveBeenCalledOnce();
    // The assistant is switched off for now (see platform/features.js).
    expect(screen.queryByRole("button", { name: "Ask AI" })).toBeNull();
  });

  it("offers the workspace as a destination when reading documentation", () => {
    render(
      <MemoryRouter initialEntries={["/docs/science/polarization"]}>
        <AssistantProvider>
          <TopBar inWorkspace={false} onSearch={vi.fn()} />
        </AssistantProvider>
      </MemoryRouter>,
    );
    const workspace = screen.getByRole("link", { name: "Open Workspace" });
    expect(workspace).toHaveAttribute("href", "/workspace");
    expect(workspace).not.toHaveAttribute("aria-current");
    expect(workspace).toHaveTextContent("→");
    expect(screen.getByRole("link", { name: "Radar Science" })).toHaveClass("is-active");
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveClass("is-active");
  });
});

describe("docs navigation", () => {
  it("has an MDX file for every ordinary page", () => {
    const missing = allPages()
      .filter((p) => !p.mcpTools)
      .filter((p) => !docs.hasPage(p.tab.id, p.slug))
      .map((p) => `${p.tab.id}/${p.slug}`);
    expect(missing).toEqual([]);
  });

  it("shows the MCP server docs but leaves the assistant out by default", () => {
    const slugs = allPages().map((p) => p.slug);
    expect(slugs).toEqual(expect.arrayContaining(["mcp", "mcp-install", "mcp-tools", "mcp-examples"]));
    expect(slugs).not.toContain("assistant");
    expect(TABS.map((t) => t.id)).toEqual(["get-started", "science", "data", "developers"]);
    const paths = operations().map((o) => o.path);
    expect(paths.some((path) => path.startsWith("/api/tools"))).toBe(true);
    expect(paths.some((path) => path.startsWith("/api/assistant"))).toBe(false);
    expect(paths).toEqual(expect.arrayContaining(["/api/health", "/api/stories", "/api/findings/{slug}", "/api/coverage-check"]));
  });

  it("has unique slugs within each tab", () => {
    for (const tab of TABS) {
      const slugs = tab.sections.flatMap((s) => s.pages.map((p) => p.slug));
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  it("finds neighbours for the pager", () => {
    const found = findPage("science", "polarization");
    expect(found.prev.slug).toBe("how-sar-works");
    expect(found.next.slug).toBe("interferometry");
  });
});

it("keeps the current page visible while a documentation page loads", async () => {
  const scheme = new EventTarget();
  scheme.matches = false;
  vi.stubGlobal("matchMedia", vi.fn(() => scheme));
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(api, "fetchSites").mockResolvedValue([]);
  let resolvePage;
  const pending = new Promise((resolve) => { resolvePage = resolve; });
  const loadPage = vi.spyOn(docs, "loadPage").mockReturnValue(pending);
  try {
    render(<MemoryRouter><App /></MemoryRouter>);
    const homeHeading = screen.getByRole("heading", { level: 1 });
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    await act(async () => {
      fireEvent.click(within(nav).getByRole("link", { name: "Radar Science" }));
    });

    expect(loadPage).toHaveBeenCalledWith("science", "how-sar-works");
    expect(homeHeading).toBeVisible();
    expect(screen.queryByText("Loading documentation…")).toBeNull();

    await act(async () => resolvePage({
      default: () => <p>Radar documentation body</p>,
      meta: { title: "How radar sees Earth" },
    }));
    expect(await screen.findByRole("heading", { name: "How radar sees Earth" })).toBeVisible();
    expect(screen.getByText("Radar documentation body")).toBeVisible();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.mode;
  }
});

describe("OpenAPI helpers", () => {
  it("builds code samples with path and query parameters", () => {
    const op = operationById("getSite");
    const samples = codeSamples(op, { site_id: "3" }, null);
    expect(samples.map((s) => s.id)).toEqual(["curl", "python", "javascript"]);
    expect(samples[0].code).toContain("/api/sites/3");
  });

  it("includes a JSON body for POST operations", () => {
    const op = operationById("startProfile");
    const [curl, python] = codeSamples(op, {}, '{"line": [[1, 2], [3, 4]]}');
    expect(curl.code).toContain("-X POST");
    expect(python.code).toContain("json=");
  });
});

describe("workspace links", () => {
  it("encodes site and date", () => {
    expect(workspaceHref({ site: "sylhet-haor-floods", date: "2026-07-14" }))
      .toBe("/workspace?site=sylhet-haor-floods&date=2026-07-14");
    expect(workspaceHref()).toBe("/workspace");
  });
});

describe("<Markdown />", () => {
  it("renders lists, code, tables and internal links without HTML injection", () => {
    render(
      <MemoryRouter>
        <Markdown
          text={[
            "See [Polarization](/docs/science/polarization) and **HV**.",
            "",
            "- one",
            "- two",
            "",
            "| a | b |",
            "| - | - |",
            "| 1 | 2 |",
            "",
            "```python",
            "print('hi')",
            "```",
            "<img src=x onerror=alert(1)>",
          ].join("\n")}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Polarization" })).toHaveAttribute("href", "/docs/science/polarization");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("print('hi')")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
