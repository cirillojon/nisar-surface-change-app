export function formatAmount(value, unit = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  const abs = Math.abs(value);
  const text = value
    .toLocaleString("en-US", {
      maximumFractionDigits: abs >= 100 ? 0 : abs >= 10 ? 1 : 2,
    })
    .replace("-", "−");
  if (unit === "%") return `${text}%`;
  return unit ? `${text} ${unit}` : text;
}

export function describeMeasurement(metric, value, unit) {
  if (metric !== "los_mm" || !Number.isFinite(value)) {
    return { amount: formatAmount(value, unit), direction: null };
  }
  const direction = value < 0
    ? "Away from the satellite"
    : value > 0 ? "Toward the satellite" : "No measured movement";
  return { amount: formatAmount(Math.abs(value), unit), direction };
}

/**
 * A site's NISAR series, one per metric of its change type, in that order,
 * leaving out `skip` and metrics without observations.
 */
export function siteSeries(changeType, observations = [], skip = null) {
  return (changeType?.metrics ?? [])
    .filter((metric) => metric.id !== skip)
    .map((metric) => ({
      id: metric.id,
      label: metric.label,
      unit: metric.unit,
      description: metric.description,
      points: observations
        .filter((o) => o.metric === metric.id)
        .map((o) => ({ date: o.observed_on, value: o.value })),
    }))
    .filter((series) => series.points.length > 0);
}
