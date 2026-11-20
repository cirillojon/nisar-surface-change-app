/* Satellite mark and inline icons for the platform shell. */

export function Logo({ size = 32 }) {
  return (
    <img className="pf-logo" src={`${import.meta.env.BASE_URL}nisar-app-icon.png`} width={size} height={size} alt="" />
  );
}

const paths = {
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Zm0 14a2 2 0 0 1 2-2h13",
  code: "m8 8-4 4 4 4M16 8l4 4-4 4",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14",
  plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4",
  drawArea: "M5 9V5h4m6 0h4v4m0 6v4h-4m-6 0H5v-4",
  drawLine: "m7.4 16.6 9.2-9.2M8 18a2 2 0 1 0-4 0 2 2 0 0 0 4 0Zm12-12a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z",
  compass: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM15.5 8.5l-2 5-5 2 2-5 5-2Z",
  menu: "M4 6h16M4 12h16M4 18h16",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 2-4-4",
};

export function Icon({ name, size = 20, strokeWidth = 1.7 }) {
  return (
    <svg className="pf-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? paths.book} />
    </svg>
  );
}
