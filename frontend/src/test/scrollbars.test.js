import { afterEach, expect, it, vi } from "vitest";

import { watchScrollbars } from "../platform/scrollbars.js";

const activity = "data-scrollbar-active";
const viewport = document.documentElement;
let watcher;

afterEach(() => {
  watcher?.stop();
  viewport.scrollTop = 0;
  vi.useRealTimers();
});

function scrollPage(top) {
  viewport.scrollTop = top;
  document.dispatchEvent(new Event("scroll"));
}

it("shows the viewport thumb on scroll and hides it for route navigation resets", () => {
  vi.useFakeTimers();
  viewport.scrollTop = 350;
  watcher = watchScrollbars();

  scrollPage(0);
  expect(viewport).not.toHaveAttribute(activity);
  scrollPage(80);
  expect(viewport).toHaveAttribute(activity);

  viewport.scrollTop = 160;
  watcher.resetViewport();
  scrollPage(160);
  expect(viewport).not.toHaveAttribute(activity);
  scrollPage(175);
  expect(viewport).toHaveAttribute(activity);
});

it("hides each thumb after its own scroll activity ends", () => {
  vi.useFakeTimers();
  watcher = watchScrollbars();
  const pane = document.createElement("div");
  document.body.append(pane);
  try {
    scrollPage(80);
    pane.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(300);
    pane.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(300);

    expect(viewport).not.toHaveAttribute(activity);
    expect(pane).toHaveAttribute(activity);

    vi.advanceTimersByTime(300);
    expect(pane).not.toHaveAttribute(activity);
  } finally {
    pane.remove();
  }
});
