import { QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import AssistantDrawer from "./platform/assistant/AssistantDrawer.jsx";
import BriefPage from "./platform/BriefPage.jsx";
import { AssistantProvider } from "./platform/assistant/assistantStore.jsx";
import { AI_ENABLED } from "./platform/features.js";
import CommandPalette from "./platform/CommandPalette.jsx";
import DocsLayout from "./platform/docs/DocsLayout.jsx";
import Footer from "./platform/Footer.jsx";
import Home from "./platform/Home.jsx";
import NotFound from "./platform/NotFound.jsx";
import { watchScrollbars } from "./platform/scrollbars.js";
import TopBar from "./platform/TopBar.jsx";
import WatchPage from "./platform/WatchPage.jsx";
import WorkspaceHost from "./platform/WorkspaceHost.jsx";
import { isTyping, modalOpen } from "./services/keys.js";
import { createQueryClient } from "./services/queryClient.js";

const TITLE = "NISAR Surface Change Explorer";

function PageScroll({ scrollbars }) {
  const { pathname, hash } = useLocation();
  useLayoutEffect(() => {
    const anchor = hash && document.getElementById(hash.slice(1));
    if (anchor) anchor.scrollIntoView();
    else window.scrollTo({ top: 0 });
    scrollbars.current?.resetViewport();
  }, [pathname, hash, scrollbars]);
  return null;
}

// The platform: a top bar over Home, the docs and the map workspace, with
// the AI assistant and search available everywhere. The workspace is not a
// <Route>: WorkspaceHost keeps it mounted (hidden) once visited, so the map
// and its selection survive a trip to the docs and back.
export default function App() {
  const { pathname } = useLocation();
  const inWorkspace = pathname === "/workspace" || pathname.startsWith("/workspace/");
  const [searchOpen, setSearchOpen] = useState(false);
  // Server data shared by the pages (one cache per app).
  const [queryClient] = useState(createQueryClient);
  const scrollbars = useRef(null);
  const navigate = useNavigate();

  // Plain <a href="/docs/..."> links (in MDX, the spec, assistant replies)
  // navigate in-app instead of reloading, so the workspace keeps its state.
  useEffect(() => {
    const onClick = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const a = event.target.closest?.("a[href]");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href?.startsWith("/") || href.startsWith("//") || href.startsWith("/api/")) return;
      event.preventDefault();
      navigate(href);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [navigate]);

  // Backspace: back to the previous page or screen (opening a place, a story
  // or a tab adds a step to the history). Not while typing, while a dialog
  // is open, mid-drawing (Backspace removes the line's last point there),
  // or during the tour and demo mode (their Backspace goes back a step).
  // Only within this site: the first page here has nowhere to go back to.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Backspace" || event.defaultPrevented || event.repeat) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isTyping(document.activeElement) || modalOpen() || document.querySelector(".draw-bar")) return;
      if (!(window.history.state?.idx > 0)) return;
      event.preventDefault();
      navigate(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.mode = inWorkspace ? "workspace" : "docs";
    // Browser chrome / status bar matches the top bar: --bg in the workspace, --paper elsewhere.
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", inWorkspace ? "#101012" : "#19191c");
    if (inWorkspace) document.title = `Workspace · ${TITLE}`;
    else if (pathname === "/") document.title = TITLE;
  }, [inWorkspace, pathname]);

  useLayoutEffect(() => {
    const watcher = watchScrollbars();
    scrollbars.current = watcher;
    return () => {
      watcher.stop();
      scrollbars.current = null;
    };
  }, [pathname]);

  return (
    <QueryClientProvider client={queryClient}>
      <AssistantProvider>
        <div className="pf-root">
          <a className="pf-skip" href="#pf-main">Skip to content</a>
          <TopBar inWorkspace={inWorkspace} onSearch={() => setSearchOpen(true)} />
          <div className="pf-stage">
            <div className="pf-main-col">
              {!inWorkspace && (
                <div id="pf-main" className="pf-page">
                  <Suspense fallback={<p className="pf-loading" role="status">Loading documentation…</p>}>
                    <Routes>
                      <Route path="/" element={<Home />} />
                      <Route path="/docs" element={<Navigate to="/docs/get-started/what-is-nisar" replace />} />
                      <Route path="/docs/:tabId" element={<DocsLayout />} />
                      <Route path="/docs/:tabId/:slug" element={<DocsLayout />} />
                      <Route path="/brief/:slug" element={<BriefPage />} />
                      <Route path="/watch" element={<WatchPage />} />
                      <Route path="/watch/:id" element={<WatchPage />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                    <PageScroll scrollbars={scrollbars} />
                  </Suspense>
                  <Footer />
                </div>
              )}
              <WorkspaceHost active={inWorkspace} />
            </div>
            {AI_ENABLED && <AssistantDrawer />}
          </div>
          <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
        </div>
      </AssistantProvider>
    </QueryClientProvider>
  );
}
