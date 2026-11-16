import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";

import { footprintText } from "../services/chain.js";
import { areaChainQuery, siteChainQuery } from "../services/queries.js";
import EvidenceCard from "./impact/EvidenceCard.jsx";
import { MomentPortal, MomentsSection } from "./impact/Moments.jsx";
import { activeMomentOf, fitOf, passLabel, passesOf, radarOf, relatedOf, timeAxis } from "./impact/model.js";
import { ObservationReading, RadarRecord } from "./impact/Record.jsx";
import { CompareSection, MoreSeries, SourcesSection } from "./impact/Related.jsx";
import "./ImpactChain.css";

/** A site's record, or a drawn area's (which waits for the dates of its first search). */
function useChainRecord(siteId, area) {
  const { bbox, start, end } = area ?? {};
  return useQuery(bbox ? areaChainQuery(bbox, start, end) : siteChainQuery(siteId));
}

/**
 * Which moment is shown, whether it was picked (so its caption shows), and
 * whether its pop-up was closed. The story reads in order: a record opens on
 * its first moment, and puts that moment's pass and layer on the map, rather
 * than on whichever moment holds the latest pass; a pass that was asked for
 * (a link, a finding) stays put, as does a closed card. Used by the record's
 * body, which starts afresh for each record (see ChainBody's key).
 */
function useMoments(chain, { selectedDate, onSelectDate, onSelectLayer, keepDate, open }) {
  const first = chain.moments?.[0] ?? null;
  const opensOnFirst = Boolean(first) && !keepDate && open;
  const [momentId, setMomentId] = useState(() => (opensOnFirst ? first.id : null));
  const [explained, setExplained] = useState(false);
  const [popupHidden, setPopupHidden] = useState(false);
  // The map follows the first moment once, when the record opens on it.
  const opening = useRef(opensOnFirst ? { first, selectedDate, onSelectDate, onSelectLayer } : null);
  useLayoutEffect(() => {
    const open = opening.current;
    opening.current = null;
    if (!open) return;
    if (open.first.focus !== open.selectedDate) open.onSelectDate?.(open.first.focus);
    if (open.first.layer) open.onSelectLayer?.(open.first.layer);
  }, []);

  const select = (moment) => {
    setMomentId(moment.id);
    setExplained(true);
    setPopupHidden(false);
    if (moment.focus !== selectedDate) onSelectDate?.(moment.focus);
    if (moment.layer) onSelectLayer?.(moment.layer);
  };
  return { momentId, explained, popupHidden, hidePopup: () => setPopupHidden(true), select };
}

/** While the record loads, why it couldn't, or why there is none. */
function ChainPending({ chain, error, onRetry }) {
  let message = "Loading the NISAR record…";
  if (error) message = `The NISAR story could not be loaded (${error.message || "Failed to load"}).`;
  else if (chain) message = chain.reason ?? "This study site has no story yet.";
  return (
    <>
      <p className={error ? "chain-question warning" : "chain-question"} role="status">{message}</p>
      {error && (
        <button className="btn btn-secondary btn-small chain-retry" type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </>
  );
}

function CatalogNotice({ onReturnToStudy }) {
  if (!onReturnToStudy) return null;
  return (
    <div className="chain-map-notice">
      <p>The map is showing catalog imagery. The charts below use the study series.</p>
      <button type="button" className="btn btn-link" onClick={onReturnToStudy}>Return to study images</button>
    </div>
  );
}

/** Which record the card shows: a site's, or a drawn area's over its search dates. */
const chainKey = ({ siteId, area }) => (area ? `${area.bbox}|${area.start}|${area.end}` : `site-${siteId}`);

/** The card's own state: the related series picked, and which disclosures are open. */
function useChainUi() {
  const [relatedId, setRelatedId] = useState(null);
  const [compareOpen, setCompareOpen] = useState(true);
  const [momentsOpen, setMomentsOpen] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const bodyRef = useRef(null);
  const toggleInfo = () => {
    setInfoOpen(!infoOpen);
    if (!infoOpen) bodyRef.current?.scrollTo?.({ top: 0 });
  };
  return { relatedId, setRelatedId, compareOpen, setCompareOpen, momentsOpen, setMomentsOpen, infoOpen, toggleInfo, bodyRef };
}

/** Everything the loaded record shows, worked out from it, the props and the card's state. */
function recordView(chain, props, ui) {
  const { area, areaObservation, passDates, selectedDate, onSelectDate, onSaveMoment, momentHost, showMomentPopup } = props;
  const moments = chain.moments ?? [];
  const series = radarOf({ chain, area, areaObservation });
  const passes = passesOf(passDates, series.radar);
  const axis = timeAxis({ passes, radar: series.radar, start: area?.start, end: area?.end, windowDays: chain.window_days });
  return {
    moments,
    series,
    passes,
    pass: series.radar?.points.find((p) => p.date === selectedDate),
    related: relatedOf({ chain, area, radar: series.radar, relatedId: ui.relatedId }),
    onSaveMoment,
    usePopup: Boolean(showMomentPopup && momentHost),
    shared: { axis, passes, selectedDate, onSelectDate },
  };
}

/** The loaded record: the lanes, the moments and the context around them. */
function ChainBody({ chain, view, ui, props }) {
  const { moments, series, pass, related, shared } = view;
  const momentState = useMoments(chain, props);
  const { moment: active, index: activeIndex } = activeMomentOf(moments, props.selectedDate, momentState.momentId);
  const saveMoment = view.onSaveMoment ? (m) => view.onSaveMoment({ ...m, index: activeIndex }) : null;
  const step = (by) => moments[activeIndex + by] && momentState.select(moments[activeIndex + by]);
  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Make the scrollable analysis reachable by keyboard. */}
      <div ref={ui.bodyRef} className="chain-body" role="group" aria-label="NISAR record" tabIndex={0}>
        <CatalogNotice onReturnToStudy={props.onReturnToStudy} />
        <RadarRecord
          {...shared}
          series={series}
          moment={active}
          fit={fitOf(active)}
          value={pass?.value}
          pass={pass}
          passQuality={props.passQuality}
          infoOpen={ui.infoOpen}
          area={props.area}
          areaObservation={props.areaObservation}
        />
        <MomentsSection
          moments={moments}
          active={active}
          explained={momentState.explained}
          usePopup={view.usePopup}
          open={ui.momentsOpen}
          onToggle={ui.setMomentsOpen}
          onSelect={momentState.select}
          onSave={saveMoment}
        />
        <CompareSection
          {...shared}
          chain={chain}
          hasRadar={Boolean(series.radar)}
          related={related}
          moment={active}
          open={ui.compareOpen}
          onToggle={ui.setCompareOpen}
          onPickRelated={ui.setRelatedId}
        />
        <MoreSeries {...shared} series={props.moreSeries} />
        <SourcesSection
          chain={chain}
          series={series}
          fpText={series.metric === "water_pct" ? footprintText(series.footprint) : null}
          area={props.area}
          hasMoments={moments.length > 0}
          driver={related.driver}
        />
      </div>
      <MomentPortal
        host={props.momentHost}
        shown={props.open && props.showMomentPopup && !momentState.popupHidden}
        moment={active}
        index={activeIndex}
        count={moments.length}
        onStep={step}
        onClose={momentState.hidePopup}
        onSave={saveMoment}
      />
    </>
  );
}

/**
 * What NISAR measured at a study site or drawn area, with a few public
 * series on the same time axis. For curated sites, short "moments" sum up
 * stretches of the record; every number in them comes from the NISAR
 * values. The vertical line is the pass shown on the map; click or drag a
 * chart to move it. Picking a moment also picks the map layer that shows it.
 *
 * Props: `siteId` or `area` ({ bbox: "w,s,e,n", start, end }); the area's
 * NISAR series (`areaObservation`); the pass days on the axis (`passDates`);
 * the pass shown (`selectedDate`, `passQuality`) and `onSelectDate`;
 * `onSelectLayer` for a moment's map layer; `onSaveMoment`; `momentHost`
 * (where the moment pop-up goes over the map) and `showMomentPopup`; the
 * site's other series (`moreSeries`); `keepDate` (the pass was asked for by
 * a link or a finding: don't move off it); `open` / `onOpenChange`;
 * `onReturnToStudy` while the catalog's images are on the map.
 */
export default function ImpactChain(rawProps) {
  const props = { siteId: null, area: null, open: true, showMomentPopup: true, ...rawProps };
  const { data: chain, error, refetch } = useChainRecord(props.siteId, props.area);
  const ui = useChainUi();
  const heading = props.area ? "Your area over time" : "What NISAR saw";
  const loaded = chain && chain.available !== false;
  const view = loaded ? recordView(chain, props, ui) : null;
  // One card throughout, so it stays in place (and keeps focus) as the record loads.
  return (
    <EvidenceCard
      heading={heading}
      passDate={props.selectedDate}
      passLabel={view && passLabel(view.passes, props.selectedDate)}
      reading={view && <ObservationReading series={view.series} value={view.pass?.value} infoOpen={ui.infoOpen} onToggleInfo={ui.toggleInfo} />}
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      {view ? (
        // Each record (a site's, or an area's over its dates) starts on its own first moment.
        <ChainBody key={chainKey(props)} chain={chain} view={view} ui={ui} props={props} />
      ) : (
        <ChainPending chain={chain} error={error} onRetry={() => refetch()} />
      )}
    </EvidenceCard>
  );
}
