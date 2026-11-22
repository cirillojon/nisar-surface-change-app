// What the evidence card (ImpactChain) shows and how it formats it.

const dayFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const monthFmt = new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" });
export const tickFmt = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
export const fmtDay = (iso) => dayFmt.format(new Date(`${iso}T00:00:00Z`));

export const DAY_MS = 86400000;
// Passes covering less of the box than this are drawn hollow.
export const FULL_COVERAGE = 95;
export const METHODS_URL = "/docs/data/methods";
export const NISAR_CATALOG = "https://cmr.earthdata.nasa.gov/search/site/collections/directory/ASF/gov.nasa.eosdis";

export const COLORS = {
  rain: "var(--chain-water)",
  river: "var(--chain-water)",
  quakes: "var(--chain-quakes)",
  radar: "var(--chain-radar)",
};

// What each NISAR measurement is, in a few facts rather than prose.
export const METRIC_INFO = {
  water_pct: {
    title: "Open water",
    product: "L2 backscatter (GCOV)",
    facts: [
      ["Measures", "Share of the area every pass imaged where the radar return is very low (HH below −18 dB), as calm water is."],
      ["Same ground", "Pixels some pass did not image are left out of every value, so passes are compared over the same area."],
      ["Can miss", "Flooded vegetation and wind-roughened water."],
      ["Can include", "Smooth bare ground, which also returns little to the radar."],
      ["Pixels", "80 m, L-band"],
    ],
  },
  hv_db: {
    title: "Crop canopy (HV)",
    product: "L2 backscatter (GCOV)",
    facts: [
      ["Measures", "Median cross-polarized (HV) radar return over the box."],
      ["Reads higher", "With more leaves, stems and moisture in the canopy."],
      ["Pixels", "80 m, L-band"],
    ],
  },
  los_mm: {
    title: "Ground movement",
    product: "L2 interferograms (GUNW)",
    facts: [
      ["Measures", "Movement along the satellite’s line of sight, added up over 12-day pairs."],
      ["Relative to", "The white reference point on the map."],
      ["Sign", "Negative means away from the satellite."],
    ],
  },
  soil_moisture: {
    title: "Surface soil moisture",
    product: "L3 soil moisture (SME2)",
    facts: [
      ["Measures", "Water per volume of topsoil, estimated from backscatter."],
      ["Combined", "Median over usable pixels, weighted by coverage across frames."],
      ["Pixels", "200 m"],
    ],
  },
};

export const CATALOG_PRODUCTS = {
  GCOV: "L2 backscatter (GCOV)",
  GUNW: "L2 interferograms (GUNW)",
  SME2: "L3 soil moisture (SME2)",
};
