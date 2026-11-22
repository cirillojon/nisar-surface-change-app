import { describe, expect, it } from "vitest";

import { LAYER_LABEL, fmtDay, momentDraft, nisarSource, placeDraft, viewDraft } from "../workspace/drafts.js";

const changeType = {
  id: "flood",
  metrics: [
    { id: "water_pct", label: "Open water", unit: "%" },
    { id: "hh_db", label: "HH backscatter", unit: "dB" },
  ],
};

const site = {
  slug: "sylhet",
  name: "Sylhet",
  product: "GCOV",
  frame: "12/34",
  change_type: "flood",
  story_metric: "water_pct",
  footprint: { pct_of_box: 100 },
  scenes: [
    { date: "2026-06-01", mode: "DH" },
    { date: "2026-06-13", mode: "DH" },
    { date: "2026-06-25", mode: "QP" },
    { date: "2026-07-07", mode: "DH" },
  ],
  observations: [{ metric: "water_pct", observed_on: "2026-06-13", value: 42.5 }],
};

const moment = {
  title: "The flood peaks",
  start: "2026-06-01",
  end: "2026-06-25",
  display: "+30 points",
  detail: "detail",
  caption: "caption",
};

const place = {
  slug: "etna",
  name: "Etna",
  frame: "56/78",
  headline: "New lava flow",
  status: "visible",
  look_for: "A dark tongue on the south flank",
  suggested: ["2026-06-17", "2026-10-27"],
};

describe("shared labels", () => {
  it("names NISAR sources with and without a frame", () => {
    expect(nisarSource("GCOV", "1/2")).toBe("NASA/ISRO NISAR L2 GCOV, track/frame 1/2, via ASF DAAC");
    expect(nisarSource("GUNW")).toBe("NASA/ISRO NISAR L2 GUNW, via ASF DAAC");
  });

  it("formats days in UTC and leaves a missing day empty", () => {
    expect(fmtDay("2026-01-01")).toBe("Jan 1, 2026");
    expect(fmtDay(null)).toBe("");
  });

  it("labels every image layer and the change map", () => {
    expect(LAYER_LABEL.change).toBe("Change map");
    expect(LAYER_LABEL.color).toBe("Color (HH, HV)");
  });
});

describe("momentDraft", () => {
  it("is null without a site", () => {
    expect(momentDraft({ site: null, moment, index: 0 })).toBeNull();
  });

  it("counts the passes and modes within the moment", () => {
    const draft = momentDraft({ site, changeType, siteLayer: "hh", storyTitle: "Floods", moment, index: 2 });
    expect(draft.kind).toBe("moment");
    expect(draft.title).toBe("Sylhet: The flood peaks");
    expect(draft.source).toEqual({ slug: "sylhet", moment: 2, story: "Floods" });
    expect(draft.evidence.passes).toBe("3 passes");
    expect(draft.evidence.mode).toBe("DH, QP");
    expect(draft.evidence.label).toBe("Open water");
    expect(draft.evidence.footprint).toBe("Every pass imaged the whole box.");
    expect(draft.evidence.source).toBe("NASA/ISRO NISAR L2 GCOV, track/frame 12/34, via ASF DAAC");
  });

  it("shows the moment's own layer and focus date over the map's", () => {
    const draft = momentDraft({
      site, changeType, siteLayer: "hh", storyTitle: "Floods",
      moment: { ...moment, layer: "water", focus: "2026-06-13" }, index: 0,
    });
    expect(draft.view).toMatchObject({ mode: "stories", date: "2026-06-13", layer: "water", layerLabel: LAYER_LABEL.water });
  });

  it("uses the map's layer and the moment's end otherwise, and says 1 pass", () => {
    const draft = momentDraft({
      site, changeType, siteLayer: "hh", storyTitle: "Floods",
      moment: { ...moment, start: "2026-07-07", end: "2026-07-07" }, index: 0,
    });
    expect(draft.view).toMatchObject({ date: "2026-07-07", layer: "hh" });
    expect(draft.evidence.passes).toBe("1 pass");
  });

  it("leaves out the footprint for a metric other than open water", () => {
    const draft = momentDraft({ site: { ...site, story_metric: "hh_db" }, changeType, siteLayer: "hh", moment, index: 0 });
    expect(draft.evidence.footprint).toBeNull();
    expect(draft.evidence.label).toBe("HH backscatter");
  });
});

describe("placeDraft", () => {
  it("is null without a place", () => {
    expect(placeDraft({ place: null, kind: "view" })).toBeNull();
  });

  it("falls back to the place's suggested dates and the color layer", () => {
    const draft = placeDraft({ place, kind: "view", layer: null, dates: null });
    expect(draft.source).toBeNull();
    expect(draft.view).toMatchObject({ mode: "investigate", place: "etna", layer: "color" });
    expect(draft.evidence).toMatchObject({
      label: "New lava flow",
      display: "Clearly visible",
      start: "2026-06-17",
      end: "2026-10-27",
      limits: [],
      source: "NASA/ISRO NISAR L2 GCOV, track/frame 56/78, via ASF DAAC",
    });
  });

  it("records a story moment with the shown dates and layer", () => {
    const draft = placeDraft({
      place: { ...place, event: { label: "Eruption", date: "2026-08-01" } },
      kind: "moment",
      layer: "change",
      dates: { from: "2026-07-11", to: "2026-08-16" },
      story: { title: "Etna erupts" },
    });
    expect(draft.source).toEqual({ slug: "etna", moment: null, story: "Etna erupts" });
    expect(draft.view).toMatchObject({ mode: "stories", layer: "change", layerLabel: "Change map" });
    expect(draft.evidence).toMatchObject({ start: "2026-07-11", end: "2026-08-16" });
    expect(draft.evidence.limits).toEqual(["Reported event (not a NISAR measurement): Eruption, 2026-08-01"]);
  });

  it("shows an unknown status as it is", () => {
    expect(placeDraft({ place: { ...place, status: "odd" }, kind: "view" }).evidence.display).toBe("odd");
  });
});

describe("viewDraft", () => {
  const scene = { date: "2026-06-13", valid_pct: 97, mode: "DH", quality: "good", granule_id: "G1" };

  it("is null when nothing is on the map", () => {
    expect(viewDraft({})).toBeNull();
  });

  it("prefers a gallery place over everything else", () => {
    const draft = viewDraft({ place, placeLayer: "hh", site, scene, profileLine: [[0, 0], [1, 1]] });
    expect(draft).toMatchObject({ kind: "view", title: "Etna", view: { place: "etna", layer: "hh" } });
  });

  it("saves a study site on its shown date with its value", () => {
    const draft = viewDraft({ site, scene, changeType, siteLayer: "water", siteHasStory: true });
    expect(draft.title).toBe("Sylhet, Jun 13, 2026");
    expect(draft.view).toMatchObject({ mode: "stories", site: "sylhet", date: "2026-06-13", layer: "water" });
    expect(draft.evidence).toMatchObject({
      label: "Open water",
      display: "42.5%",
      coverage: 97,
      granule: "G1",
      footprint: "Every pass imaged the whole box.",
    });
  });

  it("uses the change type's first metric when the site has no story metric", () => {
    const draft = viewDraft({
      site: { ...site, story_metric: undefined, observations: [] },
      scene, changeType, siteLayer: "hh", siteHasStory: false,
    });
    expect(draft.view.mode).toBe("investigate");
    expect(draft.evidence.label).toBe("Open water");
    expect(draft.evidence.display).toBeNull();
  });

  it("skips a site with no shown scene and saves the drawn line", () => {
    const line = [[-155.3, 19.4], [-155.2, 19.5]];
    const draft = viewDraft({ site, scene: undefined, profileLine: line });
    expect(draft.title).toBe("Height profile along my line");
    expect(draft.view).toEqual({ mode: "investigate", line, name: "A line you drew" });
  });

  it("saves a drawn area, or the area around a map click", () => {
    const drawn = viewDraft({ aoi: { bbox: [1, 2, 3, 4], drawn: true }, areaSeries: { date: "2026-06-13", product: "GCOV" } });
    expect(drawn.title).toBe("My drawn area");
    expect(drawn.evidence).toMatchObject({ date: "2026-06-13", source: "NASA CMR search, NISAR GCOV" });
    const clicked = viewDraft({ aoi: { bbox: [1, 2, 3, 4] } });
    expect(clicked.title).toBe("Area around a map click");
    expect(clicked.evidence).toMatchObject({ date: null, source: "NASA CMR search" });
  });

  it("saves a place found by name under its name, to reopen it so", () => {
    const place = viewDraft({ aoi: { bbox: [1, 2, 3, 4], drawn: true, label: "Lake Chad" } });
    expect(place.title).toBe("Lake Chad");
    expect(place.view).toEqual({ mode: "investigate", bbox: [1, 2, 3, 4], name: "Lake Chad", label: "Lake Chad" });
  });
});
