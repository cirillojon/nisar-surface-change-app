import GranulePanel from "./GranulePanel.jsx";

/** Approximate width × height of a bbox in km. */
function sizeKm([minLon, minLat, maxLon, maxLat]) {
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const w = (maxLon - minLon) * 111.32 * Math.cos(midLat);
  const h = (maxLat - minLat) * 110.57;
  return `${Math.round(w)} × ${Math.round(h)} km`;
}

/**
 * An area the user clicked or drew on the map: pick a NISAR product and
 * explore all of its data there (time slider or newest-first mosaic).
 * `children` (the coverage summary of a drawn area) sit above the explorer.
 */
export default function AoiPanel({
  aoi,
  changeTypes,
  imagery = null,
  products,
  onBack,
  overlayOpacity,
  onOverlayOpacityChange,
  timelineHost,
  children = null,
}) {
  const product = changeTypes[0]?.product ?? "GCOV";

  return (
    <article className="panel detail" aria-label="Selected area">
      <button type="button" className="btn btn-link" onClick={onBack}>
        ← All places
      </button>
      <p className="muted small detail-meta">
        {aoi.latitude.toFixed(3)}°, {aoi.longitude.toFixed(3)}° ·{" "}
        {sizeKm(aoi.bbox)} · box {aoi.bbox.map((v) => v.toFixed(2)).join(", ")}
      </p>
      {!aoi.drawn && (
        <p className="muted small">
          Use Draw area to choose a larger or more precise region.
        </p>
      )}
      {children}

      <GranulePanel
        key={`${aoi.bbox.join(",")}:${product}:${imagery?.slug ?? ""}`}
        products={products}
        overlayOpacity={overlayOpacity}
        onOverlayOpacityChange={onOverlayOpacityChange}
        timelineHost={timelineHost}
      />
    </article>
  );
}
