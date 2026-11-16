/* Demo mode: the guided tour cut down for a live 3-minute pitch (see DemoTour.jsx).
 *
 * The presenter talks; the screen shows only what they are talking about.
 * Space moves on (and on a drawing step draws the suggested box or line if
 * the presenter hasn't), Backspace goes back, Escape leaves. On a step with
 * a `pair` of dates, ← and → switch between them.
 *
 * Fields: `card` ({ lines: [{ label?, text }] }: a big centred card instead
 * of the app), `label` (a small caption over the map), `enter(actions)`
 * (put the app in the step's state), `skip(actions)` (Space before the step
 * is done: do it for the presenter), `done(state)` (move on by itself),
 * `panel` / `chain` (show the left side panel / the right chart panel),
 * `autoplay` (start the timelapse once it can play), `keepPlaying` (don't
 * pause a timelapse on entry), `pair` ({ dates, layer }: ←/→ dates), `sr`
 * (what a screen reader hears after the caption: the step's instructions,
 * which the screen no longer shows).
 */
import { LANGTANG, SYLHET } from "./steps.js";

// Sylhet's first pass: the timelapse plays the monsoon from the start.
const SYLHET_FIRST = "2026-06-20";
// The Langtang passes either side of the 26 Aug 2026 rock slope failure.
export const LANGTANG_PAIR = ["2026-08-19", "2026-08-31"];

export const DEMO_STEPS = [
  {
    id: "problem",
    card: {
      lines: [
        {
          label: "Problem",
          text: "NISAR holds an incredible wealth of information. But it's hard for hobbyists and enthusiasts to see and understand.",
        },
        { label: "Solution", text: "We built Google Maps for NISAR." },
      ],
    },
    enter: (a) => {
      a.showWorld();
      // Every frame the demo shows, fetched while the presenter talks.
      a.preloadDemo?.();
    },
  },
  {
    id: "examples",
    card: {
      lines: [
        { text: "Anyone, researchers and hobbyists alike, can see the world." },
        { text: "Alongside NISAR, we tie in open data to tell complete stories.", small: true },
      ],
    },
    enter: (a) => a.showWorld(),
  },
  // Kīlauea: the presenter draws the box, plays it, then draws the line.
  {
    id: "kilauea-box",
    label: "Kīlauea, Hawaiʻi",
    enter: (a) => {
      a.setScene("none");
      a.showKilauea({ marks: { pin: true, box: true }, panel: false });
      a.draw("area");
    },
    skip: (a) => a.setScene("area"),
    done: (s) => s.aoiDrawn,
    sr: "Drag a box anywhere on the map; it snaps to the summit. Or press Space to draw it.",
  },
  {
    id: "kilauea-play",
    label: "Kīlauea, Hawaiʻi · NISAR radar, every pass",
    enter: (a) => {
      a.setScene("area");
      a.showKilauea({ panel: false });
    },
    keepPlaying: true,
    autoplay: true,
    sr: "Every NISAR pass over the summit, playing. Pause is under the map.",
  },
  {
    id: "kilauea-line",
    label: "Kīlauea, Hawaiʻi",
    enter: (a) => {
      // Just the satellite view: no box or radar image, so the line stands out
      // while it is drawn (and, after Back from the profile, no old line).
      a.setScene("none");
      a.showKilauea({ marks: { line: true }, panel: false });
      a.draw("line");
    },
    skip: (a) => a.setScene("line"),
    done: (s) => s.profileLine,
    sr: "Click two points on the map; the line snaps across the summit. Or press Space to draw it.",
  },
  {
    id: "kilauea-profile",
    label: "Kīlauea, Hawaiʻi · height along the line",
    enter: (a) => {
      a.setScene("line");
      a.showKilauea({ panel: true });
    },
    panel: true,
    sr: "Side panel: elevation along the line, and how far the ground rose or sank since NISAR's first pass.",
  },
  // Sylhet: straight into the monsoon timelapse; then its two charts.
  {
    id: "sylhet",
    label: "Sylhet, Bangladesh · open water, 2026 monsoon",
    enter: (a) => a.openStory(SYLHET, { date: SYLHET_FIRST, layer: "water", panel: false }),
    autoplay: true,
    sr: "The open-water timelapse plays. Pause is under the map.",
  },
  {
    id: "sylhet-charts",
    label: "Sylhet, Bangladesh · open water, 2026 monsoon",
    // Sylhet is on the map already (from the step before); this brings it back after Back.
    enter: (a) => a.openStory(SYLHET, { layer: "water", panel: false }),
    chain: true,
    keepPlaying: true,
    autoplay: true,
    sr: "Side panel: open water on each pass, and daily rain.",
  },
  // Langtang: ← / → between the passes before and after, then the change map.
  {
    id: "langtang",
    label: "Langtang, Nepal · rock slope failure, 26 Aug 2026",
    enter: (a) => {
      a.openStory(LANGTANG, { date: LANGTANG_PAIR[0], layer: "colour", panel: false });
      a.setGuide(LANGTANG_PAIR);
    },
    pair: { dates: LANGTANG_PAIR, layer: "colour" },
    sr: "Left and right arrow keys show the radar image before and after.",
  },
  {
    id: "langtang-change",
    label: "Langtang, Nepal · change since 19 Aug",
    enter: (a) => {
      a.openStory(LANGTANG, { date: LANGTANG_PAIR[0], layer: "change", panel: false });
      a.setGuide(LANGTANG_PAIR);
    },
    pair: { dates: LANGTANG_PAIR, layer: "change" },
    sr: "The change map. Left and right arrow keys show 19 and 31 August. Red: brighter. Blue: darker.",
  },
  {
    id: "close",
    card: {
      lines: [
        { text: "NISAR sees the whole world through clouds, storms and smoke, every 12 days." },
        { text: "Now you can too." },
      ],
    },
    enter: (a) => a.showWorld(),
  },
];
