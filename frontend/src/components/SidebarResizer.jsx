import { useLayoutEffect, useRef, useState } from "react";

const WIDTH_KEY = "nisar.sidebar-width";
const STEP = 16;

function dimensions(handle) {
  const sidebar = handle.closest(".sidebar");
  const workspace = sidebar.closest(".app-body");
  const style = getComputedStyle(workspace);
  const min = parseFloat(style.getPropertyValue("--workspace-sidebar-min"));
  const max = Math.floor(Math.min(
    parseFloat(style.getPropertyValue("--workspace-sidebar-limit")),
    workspace.clientWidth * parseFloat(style.getPropertyValue("--workspace-sidebar-share")),
  ));
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null;
  return {
    workspace,
    min,
    max,
    width: Math.round(sidebar.getBoundingClientRect().width),
    direction: style.direction === "rtl" ? -1 : 1,
  };
}

function saveWidth(width) {
  try {
    if (width == null) localStorage.removeItem(WIDTH_KEY);
    else localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // The width still works when browser storage is unavailable.
  }
}

export default function SidebarResizer() {
  const handleRef = useRef(null);
  const drag = useRef(null);
  const [range, setRange] = useState(null);

  useLayoutEffect(() => {
    const handle = handleRef.current;
    const sidebar = handle.closest(".sidebar");
    const workspace = sidebar.closest(".app-body");
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(saved) && saved > 0) workspace.style.setProperty("--workspace-sidebar-preferred", `${saved}px`);
    } catch {
      // Start at the CSS default when browser storage is unavailable.
    }
    const update = () => {
      if (!handle.getBoundingClientRect().width) return;
      const bounds = dimensions(handle);
      if (!bounds) return;
      const { min, max, width } = bounds;
      setRange((previous) => (
        previous?.min === min && previous.max === max && previous.width === width ? previous : { min, max, width }
      ));
    };
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(sidebar);
    observer?.observe(workspace);
    observer?.observe(handle);
    if (!observer) window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", update);
    };
  }, []);

  const setWidth = ({ workspace, min, max }, width) => {
    const clamped = Math.max(min, Math.min(max, width));
    workspace.style.setProperty("--workspace-sidebar-preferred", `${clamped}px`);
    setRange({ min, max, width: clamped });
    return clamped;
  };

  const finish = (event) => {
    const current = drag.current;
    if (current?.pointer !== event.pointerId) return;
    drag.current = null;
    delete current.workspace.dataset.sidebarResizing;
    if (current.changed) saveWidth(current.width);
  };

  const onKeyDown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = dimensions(event.currentTarget);
    if (!bounds) return;
    const delta = event.key === "ArrowLeft" ? -STEP : STEP;
    const width = event.key === "Home" ? bounds.min
      : event.key === "End" ? bounds.max
        : bounds.width + delta * bounds.direction;
    saveWidth(setWidth(bounds, width));
  };

  // A focusable ARIA separator is a window splitter with keyboard controls.
  /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
  return (
    <div
      ref={handleRef}
      className="sidebar-resizer"
      role="separator"
      tabIndex={0}
      aria-label="Resize workspace sidebar"
      aria-orientation="vertical"
      aria-controls="workspace-panel"
      aria-valuemin={range?.min}
      aria-valuemax={range?.max}
      aria-valuenow={range?.width}
      aria-valuetext={range ? `${range.width} pixels` : undefined}
      title="Resize sidebar. Drag or use arrow keys. Double-click to reset."
      onKeyDown={onKeyDown}
      onDoubleClick={(event) => {
        const workspace = event.currentTarget.closest(".app-body");
        workspace.style.removeProperty("--workspace-sidebar-preferred");
        saveWidth(null);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        const bounds = dimensions(event.currentTarget);
        if (!bounds) return;
        drag.current = { ...bounds, pointer: event.pointerId, x: event.clientX, start: bounds.width, changed: false };
        bounds.workspace.dataset.sidebarResizing = "true";
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current?.pointer !== event.pointerId) return;
        const width = Math.round(current.start + (event.clientX - current.x) * current.direction);
        const clamped = Math.max(current.min, Math.min(current.max, width));
        if (clamped === current.width) return;
        current.width = setWidth(current, clamped);
        current.changed = true;
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    />
  );
  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
}
