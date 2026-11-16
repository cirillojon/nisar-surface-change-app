/* The guided tour: a short pitch given with the app itself (see Tour.jsx).
 *
 * It follows the Space Apps pitch structure: who has a problem, what we
 * built and the proof that it works (a demo on named NASA data), what could
 * change, and the one thing to remember:
 *
 *   Problem          what the app adds · how radar sees
 *   Solution + proof any area at Kīlauea (a box, then a line) → a NISAR
 *                    observation at Sylhet → inspecting passes (with rain and
 *                    soil moisture) → saving evidence with notes → My
 *                    findings → Langtang, Nepal (everything together)
 *   Possibility      why it may have happened · the collection
 *   Close            what to remember
 *
 * Who could use each story comes from its own `next.who` in
 * app/data/stories.json: potential users, never claimed as current ones.
 *
 * No step waits on a live NASA search: the Kīlauea box and line that the
 * tour suggests match data that ships with the app (a drawing close to them
 * snaps to them). Each step's `enter(actions)` puts the
 * app in the state it describes (and again when Back returns to it).
 *
 * Fields: `part` (which part of the pitch), `target` (selectors; the first
 * visible match is outlined and pointed at), `spotlight` (more selectors
 * left unshaded, look-only), `interactive` (clicks reach the target),
 * `done(state, atEntry)` (the step completes itself and the tour moves on),
 * `next` (a Next button), `keepsDialog` (leave the save dialog open; other
 * steps close it), `finish` (the last step), `waiting` (said while the
 * target hasn't appeared), `art` (an illustration in the bubble; the step
 * then carries no pitch-part label), `unlabelled` (no pitch-part label).
 *
 * The Kīlauea drawing steps also use: `scene` ("none", "area" or "line":
 * what the map holds, put back when Back returns to the step), `midDraw`
 * (a step that only exists while the user is mid-drawing, so Back skips
 * over it), `needs(state)` (when false, go back a step: the drawing was
 * cancelled), `watch` (stay on the step after `done`, until Next), `nice`
 * (what the bubble says then). `sequence` ([date, date]: done once the
 * land player's bar has shown them in that order; its yellow lines are put
 * on the bar with `setGuide`).
 */

export const SYLHET = "sylhet-haor-floods";
export const LANGTANG = "langtang";
// Mid-July: about half of the shared area reads as open water.
const SYLHET_PEAK = "2026-07-14";
// The "Mode check" moment: the zigzag over the same ground.
const SYLHET_MODE_CHECK = "2026-09-24";
// The Langtang passes either side of the 26 Aug 2026 event.
const LANGTANG_BEFORE = "2026-08-19";
const LANGTANG_AFTER = "2026-08-31";

/** The pitch's four parts (Space Apps Seattle, 3-minute round). */
export const PARTS = [
  { id: "problem", label: "Problem" },
  { id: "solution", label: "Solution + proof" },
  { id: "possibility", label: "Possibility" },
  { id: "close", label: "Close" },
];

export const STEPS = [
  // ── Problem: who needs this, and why they can't see it today ──
  {
    id: "problem",
    part: "problem",
    target: [],
    title: "A data repository, turned into Google Maps",
    body: "The problem: NISAR's public viewers are comprehensive, but hard to navigate and slow to turn into insight.",
    hint: "Our solution: see any area fast and connect the dots, with example stories to show how.",
    unlabelled: true,
    enter: (a) => a.showList(),
    next: true,
  },
  {
    id: "radar",
    part: "problem",
    art: "sar",
    target: [],
    title: "NISAR sees through it",
    body: "NASA–ISRO radar, launched 30 July 2025. Day or night, through cloud, every 12 days.",
    hint: "Data: NISAR GCOV and GUNW, via NASA's ASF DAAC.",
    enter: (a) => a.showList(),
    next: true,
  },
  // ── Solution + proof: what we built, shown on real data ──
  // Any area, on the fly: a box and a line at Kīlauea (their data ships with the app).
  {
    id: "draw-area",
    part: "solution",
    scene: "none",
    target: ['[data-tour="draw-area"]'],
    title: "Start at Kīlauea",
    body: "The pin marks a volcano that erupted again and again through 2025–26. Click “Draw area” to look at it.",
    hint: "Find the Investigate drawing tools at the top of the map.",
    enter: (a) => a.showKilauea({ marks: { pin: true } }),
    interactive: true,
    done: (s) => s.drawing === "area" || s.aoiDrawn,
  },
  {
    id: "drag-box",
    part: "solution",
    midDraw: true,
    target: [".map-canvas"],
    title: "Drag a box around the summit",
    body: "Press on the yellow 1, hold, and drag to 2.",
    hint: "It doesn't have to be exact.",
    enter: (a) => a.showKilauea({ marks: { pin: true, box: true } }),
    interactive: true,
    done: (s) => s.aoiDrawn,
    needs: (s) => s.drawing === "area" || s.aoiDrawn,
  },
  {
    id: "play",
    part: "solution",
    scene: "area",
    target: [".map-timeline .scene-controls button"],
    spotlight: [".map-frame"],
    title: "Press Play",
    body: "Each frame is one NISAR pass, 12 days or more apart. The bright ring is the caldera wall.",
    hint: "Time, layer (HH, HV) and opacity are always here, under the map.",
    waiting: "Searching NISAR's archive for passes over your box…",
    enter: (a) => a.showKilauea(),
    interactive: true,
    done: (s) => s.playing,
    keepPlaying: true,
    watch: true,
    next: true, // let them watch; Next moves on
  },
  {
    id: "draw-line",
    part: "solution",
    scene: "area",
    target: ['[data-tour="draw-line"]'],
    title: "Click “Draw line”",
    body: "Next: how the ground rose or sank along a line across the summit.",
    enter: (a) => a.showKilauea(),
    interactive: true,
    done: (s) => s.drawing === "line" || s.profileLine,
  },
  {
    id: "drag-line",
    part: "solution",
    midDraw: true,
    target: [".map-canvas"],
    title: "Click A, then click B",
    body: "Close is enough: the suggested line opens instantly.",
    hint: "On your own lines, add as many points as you like, then press “Finish line”.",
    enter: (a) => a.showKilauea({ marks: { line: true } }),
    interactive: true,
    done: (s) => s.profileLine,
    needs: (s) => s.drawing === "line" || s.profileLine,
  },
  {
    id: "profile-elevation",
    part: "solution",
    scene: "line",
    target: ['[data-tour="profile-elevation"]'],
    title: "The ground along your line",
    body: "First, the terrain: elevation from the line's start to its end, across the summit caldera.",
    waiting: "Reading NISAR data along your line…",
    enter: (a) => a.showKilauea({ panel: true }),
    next: true,
  },
  {
    id: "profile",
    part: "solution",
    target: ['[data-tour="profile-change"]'],
    title: "How the ground changed",
    body: "The same line, now showing how far the ground rose or sank between NISAR's first pass and its latest.",
    hint: "Any gap is the crater: lava changed it so often the radar loses track.",
    waiting: "Reading NISAR data along your line…",
    enter: (a) => a.showKilauea({ panel: true }),
    next: true,
  },
  // Then the stories: curated places, with what might explain them.
  {
    id: "observation",
    part: "solution",
    target: [".moment-popup"],
    spotlight: [".map-frame"],
    title: "Open water in Sylhet",
    body: "Blue marks open water. This observation compares two radar passes during the monsoon.",
    waiting: "Loading the Sylhet passes…",
    enter: (a) => a.openStory(SYLHET, { date: SYLHET_PEAK, layer: "water" }),
    next: true,
  },
  {
    id: "inspect",
    part: "solution",
    target: [".chain .lane-hero"],
    spotlight: [".chain-observation", ".chain-moments", ".map-frame"],
    interactive: true,
    title: "Inspect and compare",
    body: "Drag the chart to change the pass on the map. Moments mark changes in the record.",
    waiting: "Loading the NISAR record…",
    enter: (a) => a.openStory(SYLHET, { date: SYLHET_PEAK, layer: "water" }),
    next: true,
    keepPlaying: true,
  },
  {
    id: "share",
    part: "solution",
    target: ['[data-tour="share-save"]'],
    spotlight: [".story-share"],
    interactive: true,
    title: "Save / share",
    body: "Evidence card, printable brief, CSV and a link.",
    hint: "Click “Save to My findings…”.",
    enter: (a) => {
      a.openStory(SYLHET, { date: SYLHET_MODE_CHECK, layer: "water", panel: true });
      a.openShare(true);
    },
    done: (s) => s.saveOpen,
    next: true,
  },
  {
    id: "notes",
    part: "solution",
    target: [".save-dialog"],
    interactive: true,
    title: "Your notes",
    body: "You can save your notes here.",
    hint: "Press Save.",
    waiting: "Opening the save form…",
    enter: (a, signal) => a.openSave(signal),
    keepsDialog: true,
    done: (s, atEntry) => s.savedCount > atEntry.savedCount,
    next: true,
  },
  {
    id: "notebook",
    part: "solution",
    target: ['#mode-mine[aria-selected="true"]'],
    spotlight: [".notebook"],
    title: "My findings",
    body: "Your evidence and notes. Build your own story and export it.",
    hint: "Open it from the tabs at the top of the left sidebar.",
    enter: (a) => a.openNotebook(),
    next: true,
  },
  // Langtang: two yellow lines on the bar mark the frames before and after;
  // the viewer clicks between them, first on the radar image, then on the change map.
  {
    id: "langtang",
    part: "solution",
    target: [".map-timeline .scene-slider"],
    spotlight: [".map-frame"],
    interactive: true,
    title: "All together: Langtang, Nepal",
    body: "A rock slope failed here on 26 Aug 2026. Click the two yellow lines to see NISAR's radar image before and after.",
    hint: "Reported event: Eos Landslide Blog.",
    nice: "Nice! The radar image before and after. Click Next.",
    waiting: "Loading the Langtang passes…",
    enter: (a) => {
      a.openStory(LANGTANG, { date: LANGTANG_BEFORE, layer: "colour", panel: true });
      a.setGuide([LANGTANG_BEFORE, LANGTANG_AFTER]);
    },
    sequence: [LANGTANG_BEFORE, LANGTANG_AFTER],
    watch: true,
  },
  {
    id: "langtang-change",
    part: "solution",
    target: [".map-timeline .scene-slider"],
    spotlight: [".map-frame"],
    interactive: true,
    title: "Now the change map",
    body: "The same two frames as a change map since 19 Aug. Click the first yellow line, then the second.",
    hint: "Red: brighter than on 19 Aug. Blue: darker.",
    nice: "Nice! A streak of change down the valley. Click Next.",
    waiting: "Building the change map…",
    enter: (a) => {
      a.openStory(LANGTANG, { date: LANGTANG_BEFORE, layer: "change", panel: true });
      a.setGuide([LANGTANG_BEFORE, LANGTANG_AFTER]);
    },
    sequence: [LANGTANG_BEFORE, LANGTANG_AFTER],
    watch: true,
  },
  // ── Possibility: what could change ──
  {
    id: "langtang-story",
    part: "possibility",
    target: ["#story-why-h"],
    mobileTarget: [".map-canvas"],
    scrollScope: "sidebar",
    spotlight: [".map-frame"],
    title: "Why may this have happened?",
    body: "Read what fits each possible explanation and what still needs testing.",
    waiting: "Loading the story…",
    enter: (a) => a.openStory(LANGTANG, { date: LANGTANG_AFTER, layer: "change", panel: true }),
    next: true,
  },
  {
    id: "collection",
    part: "possibility",
    target: [".story-list"],
    spotlight: [".map-frame"],
    title: "Explore 12 NISAR stories",
    body: "See what changed at long-term study sites and after reported events.",
    enter: (a) => a.showList(),
    next: true,
  },
  // ── Close: the one thing to remember ──
  {
    id: "close",
    part: "close",
    target: [],
    title: "Now try it yourself",
    body: "Pick a place or draw an area to see what changed between radar passes.",
    enter: (a) => a.showList(),
    next: true,
    finish: true,
  },
];
