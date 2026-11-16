// The guided tour and demo mode, as the workspace runs them.
//
// The tour's steps (components/tour/Tour.jsx, DemoTour.jsx) drive the
// workspace through `actions`. Most of those are workspace commands passed
// in (open a story, draw, show the list…); the rest are the tour's own
// state kept here: the Kīlauea marks on the map, the place the map is held
// on, the dates marked on the land player's bar, and whether a drawn line
// was matched to the suggested one.

import { useEffect, useRef, useState } from "react";

import { KILAUEA, TOUR_BOX, TOUR_LINE, TOUR_VIEW, markTourSeen } from "../../services/tour.js";
import { useStableCallback } from "../../services/useStableCallback.js";

const NO_DEMO_VIEW = { panel: false, chain: false };

/**
 * @param {object} options
 * @param {boolean} options.active  the workspace is the page shown
 * @param {{ touring: () => boolean, demo: () => boolean }} options.initial  how the workspace opens (read once)
 * @param {object} options.workspace  what the tour asks of the workspace:
 *   - stopActivity(): stop drawing, close the save dialog, release the land player
 *   - resetView(): the default workspace (Stories, nothing selected, the whole world)
 *   - showInvestigate(panel): the Investigate tab, its panel open/closed (undefined: as it is)
 *   - actions: the workspace commands the tour's steps call (see Tour.jsx)
 */
export function useTour({ active, initial, workspace }) {
  const [touring, setTouring] = useState(initial.touring);
  // Demo mode: the tour cut down for a live pitch, and which panels its step shows.
  const [demo, setDemo] = useState(initial.demo);
  const [demoView, setDemoView] = useState(NO_DEMO_VIEW);
  // Kīlauea steps: the pin / box / line drawn on the map, the view the map is
  // held on, and a nonce that returns the map to it.
  const [marks, setMarks] = useState(null);
  const [focus, setFocus] = useState(null);
  const [refit, setRefit] = useState(0);
  // Whether the line the viewer drew was matched to the suggested one.
  const [snapped, setSnapped] = useState(false);
  // Dates marked with yellow lines on the land player's bar (Langtang steps).
  const [guide, setGuide] = useState(null);
  // The header's Tour button, where focus returns when the tour ends.
  const buttonRef = useRef(null);

  const leaveKilauea = () => {
    setMarks(null);
    setFocus(null);
    setGuide(null);
  };

  const start = () => {
    workspace.stopActivity();
    setTouring(true);
  };
  const startDemo = () => {
    workspace.stopActivity();
    setDemoView(NO_DEMO_VIEW);
    setDemo(true);
    setTouring(true);
  };
  // Stable, so the tour's key handlers aren't rebound on every render.
  const end = useStableCallback(() => {
    markTourSeen();
    // Ending mid-demo at Kīlauea: leave nothing the tour had the user draw,
    // and hand back the default workspace.
    if (focus) workspace.resetView();
    workspace.stopActivity();
    setTouring(false);
    leaveKilauea();
    buttonRef.current?.focus({ preventScroll: true });
  });
  // Leaving demo mode: the default workspace, out of full screen.
  const endDemo = useStableCallback(() => {
    end();
    setDemo(false);
    workspace.resetView();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  });

  // The page around the workspace (the top bar) hides in demo mode too.
  useEffect(() => {
    if (!demo || !active) return undefined;
    document.documentElement.dataset.demo = "";
    return () => {
      delete document.documentElement.dataset.demo;
    };
  }, [demo, active]);

  const actions = {
    ...workspace.actions,
    // Each step starts from a map free of the Kīlauea drawings and place,
    // and a bar free of yellow lines.
    leaveKilauea,
    // Point at these dates on the land player's bar.
    setGuide,
    // A Kīlauea step: its tab and panel, what to draw on the map, and the
    // map held on the summit.
    showKilauea: ({ marks: shown, panel } = {}) => {
      workspace.showInvestigate(panel);
      setMarks(
        shown && {
          pin: shown.pin ? KILAUEA : null,
          box: shown.box ? TOUR_BOX : null,
          line: shown.line ? TOUR_LINE : null,
        },
      );
      setFocus(TOUR_VIEW);
      setRefit((n) => n + 1);
    },
  };

  return {
    touring,
    demo,
    demoView,
    setDemoView,
    marks,
    focus,
    refit,
    snapped,
    setSnapped,
    guide,
    buttonRef,
    start,
    startDemo,
    end,
    endDemo,
    actions,
  };
}
