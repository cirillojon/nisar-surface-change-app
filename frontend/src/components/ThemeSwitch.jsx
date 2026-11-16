import { useEffect, useState } from "react";

const PREFERENCE_KEY = "nisar-theme";
const DARK_SCHEME = "(prefers-color-scheme: dark)";

function storedTheme() {
  try {
    const value = localStorage.getItem(PREFERENCE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

export default function ThemeSwitch() {
  const [preference, setPreference] = useState(storedTheme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_SCHEME).matches);
  const dark = preference === null ? systemDark : preference === "dark";

  useEffect(() => {
    const scheme = window.matchMedia(DARK_SCHEME);
    const update = (event) => setSystemDark(event.matches);
    scheme.addEventListener("change", update);
    return () => scheme.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    const chromeColor = document.querySelector('meta[name="theme-color"]');
    if (chromeColor) {
      chromeColor.content = getComputedStyle(document.documentElement)
        .getPropertyValue("--paper").trim();
    }
  }, [dark]);

  const toggle = () => {
    const next = dark ? "light" : "dark";
    setPreference(next);
    try {
      localStorage.setItem(PREFERENCE_KEY, next);
    } catch {
      // Keep the selected theme for this session.
    }
  };

  return (
    <button
      className="btn theme-switch"
      type="button"
      role="switch"
      aria-label="Dark mode"
      aria-checked={dark}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggle}
    >
      <span className="theme-switch-icon theme-sun" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42m0-14.14-1.42 1.42m-11.3 11.3-1.42 1.42" />
        </svg>
      </span>
      <span className="theme-switch-icon theme-moon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.99 12.89A9 9 0 1 1 11.11 3a7 7 0 0 0 9.88 9.89Z" />
        </svg>
      </span>
    </button>
  );
}
