import { useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import FindingCard from "../components/FindingCard.jsx";

/**
 * A finding as a one-page brief: for a decision maker, a report or a
 * printout. Same content as the workspace card, laid out for paper.
 * /brief/<story-slug>?moment=<n>
 */
export default function BriefPage() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const raw = params.get("moment");
  const moment = raw == null || raw === "" || Number.isNaN(Number(raw)) ? null : Number(raw);
  useEffect(() => {
    document.title = "Evidence brief · NISAR Surface Change Explorer";
  }, []);
  const workspace = `/workspace?mode=stories&finding=${encodeURIComponent(slug)}${moment != null ? `:${moment}` : ""}`;
  return (
    <div className="pf-brief">
      <div className="pf-brief-bar">
        <Link to={workspace}>← Open in the workspace</Link>
        <button type="button" className="pf-btn pf-btn-primary" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      <FindingCard slug={slug} moment={moment} variant="brief" />
      <p className="pf-brief-foot small">
        NISAR Surface Change Explorer · not an official NASA or ISRO product · data: NASA/ISRO NISAR via ASF DAAC.
      </p>
    </div>
  );
}
