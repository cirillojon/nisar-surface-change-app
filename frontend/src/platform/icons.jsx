/* Small inline icons for the platform shell. Original artwork: an orbit
 * over a surface line. Not the NASA insignia (this is not a NASA product). */

export function Logo({ size = 28 }) {
  return (
    <svg className="pf-logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--pf-logo-bg)" />
      <ellipse cx="16" cy="13" rx="11" ry="4.5" fill="none" stroke="var(--pf-logo-fg)" strokeWidth="1.6" transform="rotate(-18 16 13)" />
      <circle cx="24.5" cy="9.2" r="2.2" fill="var(--pf-logo-fg)" />
      <path d="M5 24c3-2.6 5.2-2.6 7.6 0s4.6 2.6 7.2 0 5-2.6 7.2 0" fill="none" stroke="var(--pf-logo-fg)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const paths = {
  flood: "M3 15c2-1.5 3.5-1.5 5.5 0s3.5 1.5 5.5 0 3.5-1.5 5.5 0M3 19c2-1.5 3.5-1.5 5.5 0s3.5 1.5 5.5 0 3.5-1.5 5.5 0M12 3l-4 6a4 4 0 1 0 8 0l-4-6Z",
  crop: "M12 21V9M12 13c-4 0-6-3-6-6 4 0 6 3 6 6Zm0 0c4 0 6-3 6-6-4 0-6 3-6 6Zm0 4c-3 0-5-2-5-4.5 3 0 5 2 5 4.5Zm0 0c3 0 5-2 5-4.5-3 0-5 2-5 4.5Z",
  subsidence: "M3 7h18M3 12c3 0 4 5 9 5s6-5 9-5M8 3v4M16 3v4",
  volcano: "M3 20h18L15 9h-6L3 20ZM10 9l-1-3M14 9l1-3M12 9V4",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Zm0 14a2 2 0 0 1 2-2h13",
  code: "m8 8-4 4 4 4M16 8l4 4-4 4",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14",
  satellite: "M4 10 7 7l4 4-3 3-4-4ZM13 13l4-4 3 3-4 4-3-3ZM9.5 12.5l2-2M12 12l1 1M5 19a6 6 0 0 0 6-6M3 15a2 2 0 0 0 2-2",
  plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4",
  drawArea: "M5 9V5h4m6 0h4v4m0 6v4h-4m-6 0H5v-4",
  drawLine: "m7.4 16.6 9.2-9.2M8 18a2 2 0 1 0-4 0 2 2 0 0 0 4 0Zm12-12a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z",
  compass: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM15.5 8.5l-2 5-5 2 2-5 5-2Z",
  menu: "M4 6h16M4 12h16M4 18h16",
};

export function Icon({ name, size = 20, strokeWidth = 1.7 }) {
  return (
    <svg className="pf-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? paths.book} />
    </svg>
  );
}
