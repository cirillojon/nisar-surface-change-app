/* SME2 (NISAR Level-3 soil moisture) display settings. */

export const SME2_METRICS = [
  { id: "hv_db", label: "HV backscatter", unit: "dB" },
  { id: "hh_db", label: "HH backscatter", unit: "dB" },
  { id: "water_pct", label: "Open water", unit: "%" },
  {
    id: "soil_moisture",
    label: "Soil moisture",
    unit: "m³/m³",
  },
];

export const SME2_LAYERS = {
  backscatter: {
    label: "Backscatter",
    note: "SME2's HH/HV layers, colored like the crop sites.",
  },
  soil_moisture: {
    label: "Soil moisture",
    // Matches SOIL_MOISTURE_RANGE / _STOPS in app/sme2.py.
    ramp: {
      className: "ramp-soil-moisture",
      labels: ["0 (dry)", "0.25", "0.5 m³/m³ (wet)"],
    },
    legend: "Soil moisture on a 200 m grid. Gaps: water, cities, dense forest, frozen ground. Provisional; accuracy goal ±0.06 m³/m³; retrieval-quality flags are not applied here.",
  },
};
