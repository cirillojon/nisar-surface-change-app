const HIDE_DELAY_MS = 550;
const ACTIVE_ATTRIBUTE = "data-scrollbar-active";

export function watchScrollbars() {
  const viewport = document.scrollingElement ?? document.documentElement;
  const active = new Map();
  // Ignore the browser event queued by the new page's automatic scroll reset.
  let initialPosition = viewport.scrollTop;

  function clearActivity(scroller) {
    const activity = active.get(scroller);
    if (activity) window.clearTimeout(activity.timer);
    active.delete(scroller);
    scroller.removeAttribute(ACTIVE_ATTRIBUTE);
  }

  function onScroll({ target }) {
    const scroller = target === document ? viewport : target;
    if (!(scroller instanceof HTMLElement)) return;
    if (scroller === viewport && initialPosition !== undefined) {
      if (scroller.scrollTop === 0 || scroller.scrollTop === initialPosition) return;
      initialPosition = undefined;
    }

    const hideAt = performance.now() + HIDE_DELAY_MS;
    const existing = active.get(scroller);
    if (existing) {
      existing.hideAt = hideAt;
      return;
    }

    const activity = { hideAt, timer: 0 };
    function hide() {
      const remaining = activity.hideAt - performance.now();
      if (remaining > 0) {
        activity.timer = window.setTimeout(hide, Math.ceil(remaining));
        return;
      }
      clearActivity(scroller);
    }

    scroller.setAttribute(ACTIVE_ATTRIBUTE, "");
    activity.timer = window.setTimeout(hide, HIDE_DELAY_MS);
    active.set(scroller, activity);
  }

  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return {
    resetViewport() {
      initialPosition = viewport.scrollTop;
      clearActivity(viewport);
    },
    stop() {
      document.removeEventListener("scroll", onScroll, true);
      for (const scroller of active.keys()) clearActivity(scroller);
    },
  };
}
