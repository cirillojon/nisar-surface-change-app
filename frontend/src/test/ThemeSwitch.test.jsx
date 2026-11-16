import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ThemeSwitch from "../components/ThemeSwitch.jsx";

let scheme;

beforeEach(() => {
  localStorage.clear();
  scheme = new EventTarget();
  scheme.matches = false;
  vi.stubGlobal("matchMedia", vi.fn(() => scheme));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
  localStorage.clear();
});

describe("ThemeSwitch", () => {
  it("starts with the system theme and follows system changes", () => {
    scheme.matches = true;
    render(<ThemeSwitch />);

    const toggle = screen.getByRole("switch", { name: "Dark mode" });
    expect(toggle).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    scheme.matches = false;
    const change = new Event("change");
    change.matches = false;
    fireEvent(scheme, change);

    expect(toggle).not.toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("remembers the explicitly chosen theme across mounts", () => {
    const { unmount } = render(<ThemeSwitch />);
    fireEvent.click(screen.getByRole("switch", { name: "Dark mode" }));
    expect(localStorage.getItem("nisar-theme")).toBe("dark");
    unmount();

    render(<ThemeSwitch />);
    expect(screen.getByRole("switch", { name: "Dark mode" })).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
});
