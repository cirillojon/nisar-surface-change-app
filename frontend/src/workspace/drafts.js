// What "Save" puts in My findings: a draft finding built from what the
// workspace shows. Pure functions of the data passed in, so the workspace
// supplies the selection and these decide the wording and evidence.

import { footprintText } from "../services/chain.js";
import { STATUS_LABEL } from "../services/landchange.js";
import { LAYERS } from "../services/layers.js";
import { formatAmount } from "../services/measurements.js";

export const LAYER_LABEL = {
  ...Object.fromEntries(Object.entries(LAYERS).map(([id, l]) => [id, l.label])),
  change: "Change map",
};

const dayFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const fmtDay = (iso) => (iso ? dayFmt.format(new Date(`${iso}T00:00:00Z`)) : "");

export const nisarSource = (product, frame) =>
  `NASA/ISRO NISAR L2 ${product}${frame ? `, track/frame ${frame}` : ""}, via ASF DAAC`;

const metricOf = (changeType, id) => changeType?.metrics.find((m) => m.id === id);
const passesIn = (site, start, end) => (site?.scenes ?? []).filter((p) => p.date >= start && p.date <= end);
const modesOf = (passes) => [...new Set(passes.map((p) => p.mode).filter(Boolean))].join(", ") || null;
// The open-water series leaves out what some pass didn't image; say so.
const footprintFor = (site, metric) => (metric === "water_pct" ? footprintText(site?.footprint) : null);

/**
 * A curated story's moment at a study site (from its panel, its chart or the tour).
 * `changeType` is the site's change type; `siteLayer` the layer on the map.
 */
export function momentDraft({ site, changeType, siteLayer, storyTitle, moment, index }) {
  if (!site) return null;
  const metric = site.story_metric;
  const passes = passesIn(site, moment.start, moment.end);
  const layer = moment.layer ?? siteLayer;
  return {
    kind: "moment",
    title: `${site.name}: ${moment.title}`,
    notes: "",
    source: { slug: site.slug, moment: index, story: storyTitle },
    view: { mode: "stories", site: site.slug, name: site.name, date: moment.focus ?? moment.end, layer, layerLabel: LAYER_LABEL[layer] },
    evidence: {
      label: metricOf(changeType, metric)?.label,
      display: moment.display,
      detail: moment.detail,
      caption: moment.caption,
      start: moment.start,
      end: moment.end,
      passes: `${passes.length} ${passes.length === 1 ? "pass" : "passes"}`,
      mode: modesOf(passes),
      footprint: footprintFor(site, metric),
      source: nisarSource(site.product, site.frame),
    },
  };
}

/**
 * A gallery place's story moment or view: the two dates its change map compares.
 * `layer` and `dates` are what its player shows (null: the place's defaults);
 * `story` is the place's curated story, if it has one.
 */
export function placeDraft({ place, kind, layer: shownLayer, dates, story }) {
  if (!place) return null;
  const layer = shownLayer ?? "color";
  const from = dates?.from ?? place.suggested?.[0];
  const to = dates?.to ?? place.suggested?.[1];
  return {
    kind,
    title: place.name,
    notes: "",
    source: kind === "moment" ? { slug: place.slug, moment: null, story: story?.title } : null,
    view: { mode: story ? "stories" : "investigate", place: place.slug, name: place.name, layer, layerLabel: LAYER_LABEL[layer] },
    evidence: {
      label: place.headline,
      display: STATUS_LABEL[place.status] ?? place.status,
      caption: place.look_for,
      start: from,
      end: to,
      source: nisarSource("GCOV", place.frame),
      limits: place.event ? [`Reported event (not a NISAR measurement): ${place.event.label}, ${place.event.date}`] : [],
    },
  };
}

/**
 * Whatever is on the map now ("Save view"): a gallery place, a study site on
 * a date, a drawn line or an area, in that order. Null when nothing is.
 */
export function viewDraft({
  place, placeLayer, placeDates, placeStory,
  site, scene, changeType, siteLayer, siteHasStory,
  profileLine, aoi, areaSeries,
}) {
  if (place) return placeDraft({ place, kind: "view", layer: placeLayer, dates: placeDates, story: placeStory });
  if (site && scene) {
    const metric = site.story_metric ?? changeType?.metrics[0]?.id;
    const value = (site.observations ?? []).find((o) => o.metric === metric && o.observed_on === scene.date)?.value;
    const unit = metricOf(changeType, metric)?.unit;
    return {
      kind: "view",
      title: `${site.name}, ${fmtDay(scene.date)}`,
      notes: "",
      view: { mode: siteHasStory ? "stories" : "investigate", site: site.slug, name: site.name, date: scene.date, layer: siteLayer, layerLabel: LAYER_LABEL[siteLayer] },
      evidence: {
        label: metricOf(changeType, metric)?.label,
        display: value == null ? null : formatAmount(value, unit),
        date: scene.date,
        coverage: scene.valid_pct,
        mode: scene.mode,
        quality: scene.quality,
        granule: scene.granule_id,
        footprint: footprintFor(site, metric),
        source: nisarSource(site.product, site.frame),
      },
    };
  }
  if (profileLine) {
    return {
      kind: "view",
      title: "Height profile along my line",
      notes: "",
      view: { mode: "investigate", line: profileLine, name: "A line you drew" },
      evidence: {
        caption: "Height change along the line from NISAR interferogram pairs, computed when the line was drawn.",
        source: "NASA/ISRO NISAR L2 GUNW, via ASF DAAC",
      },
    };
  }
  if (aoi) {
    return {
      kind: "view",
      title: aoi.label ?? (aoi.drawn ? "My drawn area" : "Area around a map click"),
      notes: "",
      view: {
        mode: "investigate",
        bbox: aoi.bbox,
        name: aoi.label ?? (aoi.drawn ? "An area you drew" : "An area around a map click"),
        ...(aoi.label ? { label: aoi.label } : {}),
      },
      evidence: {
        caption: "NISAR passes over this area, as listed by NASA's catalog (CMR) when it was opened; values come from the passes you viewed.",
        date: areaSeries?.date ?? null,
        source: areaSeries?.product ? `NASA CMR search, NISAR ${areaSeries.product}` : "NASA CMR search",
      },
    };
  }
  return null;
}
