import { useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

import { useAssistant } from "./assistant/assistantStore.jsx";
import { loadPage } from "./docs/content.js";
import { TABS, firstPageHref } from "./docs/nav.js";
import { AI_ENABLED } from "./features.js";
import { Icon, Logo } from "./icons.jsx";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export default function TopBar({ inWorkspace, onSearch }) {
  const { pathname } = useLocation();
  const { open, toggle } = useAssistant();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef(null);

  const closeMenu = () => {
    if (!menuOpen) return;
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  };
  const onMenuKeyDown = (event) => {
    if (event.key === "Escape" && menuOpen) {
      event.stopPropagation();
      closeMenu();
    }
  };

  return (
    <header className="pf-topbar">
      <div className="pf-topbar-row">
        <Link to="/" className="pf-brand" aria-label="NISAR Surface Change Explorer, home">
          <Logo />
          <span className="pf-brand-name">
            NISAR <span className="pf-brand-sub">Surface Change Explorer</span>
          </span>
        </Link>
        <div
          className="pf-nav"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false);
          }}
        >
          <button
            ref={menuButtonRef}
            type="button"
            className="btn pf-nav-toggle"
            aria-label="Site menu"
            aria-expanded={menuOpen}
            aria-controls="pf-site-navigation"
            onClick={() => setMenuOpen((current) => !current)}
            onKeyDown={onMenuKeyDown}
          >
            <Icon name="menu" size={18} />
            <span>Menu</span>
          </button>
          <nav id="pf-site-navigation" className="pf-tabs" aria-label="Main navigation" data-open={menuOpen}>
            <NavLink
              to="/"
              end
              className={({ isActive }) => `pf-tab${isActive ? " is-active" : ""}`}
              onClick={closeMenu}
              onKeyDown={onMenuKeyDown}
            >
              Home
            </NavLink>
            {TABS.map((tab) => {
              const href = firstPageHref(tab);
              const active = pathname.startsWith(`/docs/${tab.id}`);
              const preload = () => {
                void loadPage(tab.id, tab.sections[0].pages[0].slug).catch(() => {});
              };
              return (
                <NavLink
                  key={tab.id}
                  to={href}
                  className={`pf-tab${active ? " is-active" : ""}`}
                  aria-current={active ? "true" : undefined}
                  onPointerEnter={preload}
                  onFocus={preload}
                  onClick={closeMenu}
                  onKeyDown={onMenuKeyDown}
                >
                  {tab.label}
                </NavLink>
              );
            })}
          </nav>
        </div>
        <div className="pf-topbar-actions">
          <button type="button" className="btn pf-search-btn" aria-label="Search documentation" title="Search documentation" onClick={onSearch}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
            <span className="pf-search-label">Search docs</span>
            <kbd aria-hidden="true">{isMac ? "⌘" : "Ctrl"} K</kbd>
          </button>
          {AI_ENABLED && (
            <button
              type="button"
              className="btn pf-ask-btn"
              aria-label="Ask AI"
              aria-pressed={open}
              aria-controls="pf-assistant"
              onClick={toggle}
            >
              <span aria-hidden="true">✦</span> <span className="pf-ask-label">Ask AI</span>
            </button>
          )}
          <Link
            to="/workspace"
            className="btn pf-workspace-btn"
            aria-label={inWorkspace ? undefined : "Open Workspace"}
            aria-current={inWorkspace ? "page" : undefined}
          >
            {!inWorkspace && <span className="pf-ws-open">Open </span>}Workspace
            {!inWorkspace && <span className="pf-ws-open" aria-hidden="true">→</span>}
          </Link>
        </div>
      </div>
    </header>
  );
}
