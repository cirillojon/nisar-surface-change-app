/**
 * The layer picker used wherever NISAR images are drawn on the map: study
 * sites, the land-change gallery and drawn areas. `layers` is
 * [{ id, label, disabled, reason }]; a layer the data can't supply stays
 * listed, greyed out, with the reason. Hidden when there is nothing to choose.
 */
export default function LayerSelect({ layers, value, onChange, className = "" }) {
  if (!layers || layers.filter((layer) => !layer.disabled).length < 2) return null;
  return (
    <label className={`layer-select small ${className}`.trim()}>
      <span>Layer</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Image layer">
        {layers.map((layer) => (
          <option key={layer.id} value={layer.id} disabled={layer.disabled}>
            {layer.label}
            {layer.disabled && layer.reason ? ` (${layer.reason})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
