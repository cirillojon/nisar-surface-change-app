import { Link } from "react-router-dom";

import { TABS, firstPageHref } from "./docs/nav.js";
import { MCP_ENABLED } from "./features.js";
import { Logo } from "./icons.jsx";

export default function Footer() {
  return (
    <footer className="pf-footer">
      <div className="pf-footer-grid">
        <div className="pf-footer-brand">
          <Logo size={24} />
          <p>
            <strong>NISAR Surface Change Explorer</strong>
            <br />
            An open-source project built for the NASA Space Apps Challenge 2026.
          </p>
        </div>
        <nav aria-label="Docs sections">
          <p className="pf-footer-h">Docs</p>
          <ul>
            {TABS.map((t) => <li key={t.id}><Link to={firstPageHref(t)}>{t.label}</Link></li>)}
          </ul>
        </nav>
        <nav aria-label="Tools">
          <p className="pf-footer-h">Tools</p>
          <ul>
            <li><Link to="/workspace">Map workspace</Link></li>
            <li><Link to="/docs/developers/local-setup">Run it locally</Link></li>
            {MCP_ENABLED && <li><Link to="/docs/developers/mcp">MCP server</Link></li>}
          </ul>
        </nav>
        <nav aria-label="Project">
          <p className="pf-footer-h">Project</p>
          <ul>
            <li><a href="https://github.com/cirillojon/nisar-surface-change" target="_blank" rel="noreferrer">GitHub</a></li>
            <li><Link to="/docs/data/methods">Data & methods</Link></li>
            <li><Link to="/docs/get-started/faq">Limitations</Link></li>
          </ul>
        </nav>
      </div>
      <p className="pf-footer-legal">
        Not an official NASA or ISRO product. NISAR data courtesy of NASA/JPL-Caltech and ISRO, distributed by
        the Alaska Satellite Facility DAAC. Weather and river data from their named public sources.
      </p>
    </footer>
  );
}
