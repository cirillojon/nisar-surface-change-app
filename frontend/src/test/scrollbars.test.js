import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { watchScrollbars } from "../platform/scrollbars.js";

const activity = "data-scrollbar-active";
const viewport = document.documentElement;
let watcher;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(viewport, "clientHeight", "get").mockReturnValue(808);
  vi.spyOn(viewport, "scrollHeight", "get").mockReturnValue(3232);
});

afterEach(() => {
  watcher?.stop();
  viewport.scrollTop = 0;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function scrollPage(top) {
  viewport.scrollTop = top;
  document.dispatchEvent(new Event("scroll"));
}

it("positions the floating thumb on scroll and hides it for route navigation resets", () => {
  viewport.scrollTop = 350;
  watcher = watchScrollbars();
  const thumb = document.querySelector(".pf-scrollbar-thumb");

  scrollPage(0);
  expect(thumb).not.toHaveAttribute(activity);
  scrollPage(808);
  expect(thumb).toHaveAttribute(activity);
  expect(thumb.style.height).toBe("200px");
  expect(thumb.style.transform).toBe("translateY(200px)");

  viewport.scrollTop = 160;
  watcher.resetViewport();
  scrollPage(160);
  expect(thumb).not.toHaveAttribute(activity);
  scrollPage(175);
  expect(thumb).toHaveAttribute(activity);
});

it("hides each thumb after its own scroll activity ends", () => {
  watcher = watchScrollbars();
  const thumb = document.querySelector(".pf-scrollbar-thumb");
  const pane = document.createElement("div");
  document.body.append(pane);
  try {
    scrollPage(80);
    pane.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(300);
    pane.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(300);

    expect(thumb).not.toHaveAttribute(activity);
    expect(pane).toHaveAttribute(activity);

    vi.advanceTimersByTime(300);
    expect(pane).not.toHaveAttribute(activity);
  } finally {
    pane.remove();
  }
});
