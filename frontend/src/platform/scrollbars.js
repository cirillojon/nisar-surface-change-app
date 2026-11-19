const HIDE_DELAY_MS = 550;
const ACTIVE_ATTRIBUTE = "data-scrollbar-active";
const THUMB_INSET = 4;
const MIN_THUMB_HEIGHT = 28;

export function watchScrollbars() {
  const viewport = document.scrollingElement ?? document.documentElement;
  const thumb = document.createElement("div");
  thumb.className = "pf-scrollbar-thumb";
  thumb.setAttribute("aria-hidden", "true");
  document.body.append(thumb);

  const active = new Map();
  // Ignore the browser event queued by the new page's automatic scroll reset.
  let initialPosition = viewport.scrollTop;
  let scrollRange = 0;
  let thumbTravel = 0;
  let drag = null;

  function positionThumb(top) {
    const progress = Math.max(0, Math.min(1, top / scrollRange));
    thumb.style.transform = `translateY(${progress * thumbTravel}px)`;
  }

  function measureThumb() {
    const viewportHeight = viewport.clientHeight;
    const pageHeight = viewport.scrollHeight;
    scrollRange = Math.max(0, pageHeight - viewportHeight);
    if (!scrollRange) {
      clearActivity(thumb);
      return;
    }

    // Cache the geometry so a swipe only updates the thumb's transform.
    const height = Math.max(0, viewportHeight - THUMB_INSET * 2);
    const length = Math.min(height, Math.max(MIN_THUMB_HEIGHT, height * viewportHeight / pageHeight));
    thumbTravel = height - length;
    thumb.style.height = `${length}px`;
    positionThumb(viewport.scrollTop);
  }

  function clearActivity(element) {
    const activity = active.get(element);
    if (activity) window.clearTimeout(activity.timer);
    active.delete(element);
    element.removeAttribute(ACTIVE_ATTRIBUTE);
  }

  function onScroll({ target }) {
    const scroller = target === document ? viewport : target;
    if (!(scroller instanceof HTMLElement)) return;
    if (scroller !== viewport) {
      showActivity(scroller);
      return;
    }

    const top = viewport.scrollTop;
    if (initialPosition !== undefined) {
      if (top === 0 || top === initialPosition) return;
      initialPosition = undefined;
    }
    if (!scrollRange) return;
    positionThumb(top);
    showActivity(thumb);
  }

  function showActivity(element) {
    const hideAt = performance.now() + HIDE_DELAY_MS;
    const existing = active.get(element);
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
      clearActivity(element);
    }

    element.setAttribute(ACTIVE_ATTRIBUTE, "");
    activity.timer = window.setTimeout(hide, HIDE_DELAY_MS);
    active.set(element, activity);
  }

  thumb.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.pointerType === "touch" || !scrollRange || !thumbTravel) return;
    event.preventDefault();
    thumb.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, y: event.clientY, top: viewport.scrollTop };
    thumb.dataset.dragging = "";
  });
  thumb.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId || !thumbTravel) return;
    viewport.scrollTop = drag.top + (event.clientY - drag.y) * scrollRange / thumbTravel;
  });
  thumb.addEventListener("lostpointercapture", (event) => {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    delete thumb.dataset.dragging;
    if (thumb.isConnected) showActivity(thumb);
  });

  const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(measureThumb) : null;
  sizes?.observe(document.body);
  measureThumb();
  window.addEventListener("resize", measureThumb, { passive: true });
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return {
    resetViewport() {
      initialPosition = viewport.scrollTop;
      clearActivity(thumb);
    },
    stop() {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", measureThumb);
      sizes?.disconnect();
      for (const element of active.keys()) clearActivity(element);
      thumb.remove();
    },
  };
}
