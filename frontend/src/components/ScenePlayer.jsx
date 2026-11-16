import { useEffect, useState } from "react";

import { assetUrl } from "../services/api.js";
import { loadImage } from "../services/imageCache.js";
import { usePlayback } from "../services/usePlayback.js";
import LayerSelect from "./LayerSelect.jsx";

const sameUrl = (url) => url;

function Legend({ product, imageRange, ramp, text }) {
  if (!ramp && product === "GUNW" && imageRange) {
    ramp = {
      className: "ramp-displacement",
      labels: [`−${imageRange} mm (away)`, "0", `+${imageRange} mm (toward)`],
    };
  }
  return (
    <div className="scene-legend small">
      {ramp ? (
        <>
          <div className={`ramp ${ramp.className}`} aria-hidden="true" />
          <div className="ramp-labels muted">
            {ramp.labels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </>
      ) : null}
      <p className="muted">{text}</p>
    </div>
  );
}

/**
 * Steps through a place's NISAR passes. The selected pass is drawn on the
 * map by the parent; this holds the controls plus a before/after pair.
 * Docked under the map it is the one place to play, scrub and pick a layer,
 * whatever is on the map: a study site, a gallery place or a drawn area.
 */
export default function ScenePlayer({
  scenes,
  index,
  onIndexChange,
  opacity,
  onOpacityChange,
  product,
  imageRange,
  legend,
  ramp = null,
  title = "NISAR images over time",
  preload = true,
  docked = false,
  // Image layers: the choices, the selected one and a function that maps an
  // image's URL to that layer's (see services/layers.js).
  layers = null,
  layer = null,
  onLayerChange = () => {},
  imageUrl = sameUrl,
  // The "before" pass of the comparison, when the parent needs it too (a
  // change map is drawn between it and the slider's pass).
  before = null,
  onBeforeChange = null,
  // (i) => promise that resolves when frame i can be drawn, for frames that
  // are computed rather than downloaded. Playback waits on it.
  ready = null,
  // The frame playback loops back to (default: the first).
  loopFrom = 0,
  // A line under the controls about the selected layer; more for the legend.
  note = null,
  legendExtra = null,
  // (scene) => text added after a date in the "before" menu, e.g. " (after)".
  dateLabel = null,
  // Frames to point at on the slider (the guided tour): [{ index, label }],
  // each a yellow line that shows its frame when clicked.
  guide = null,
}) {
  const [ownBefore, setOwnBefore] = useState(0);
  const beforeIndex = before ?? ownBefore;
  const setBeforeIndex = onBeforeChange ?? setOwnBefore;
  const [comparisonOpen, setComparisonOpen] = useState(!docked);
  const last = scenes.length - 1;
  const [playing, setPlaying] = usePlayback({
    count: scenes.length,
    index,
    urlAt: (i) => (scenes[i]?.image_url ? imageUrl(assetUrl(scenes[i].image_url)) : null),
    ready,
    first: loopFrom,
    onIndexChange,
  });

  // Skip preloading when the caller uses large catalog browse images.
  useEffect(() => {
    if (!preload) return;
    scenes.forEach((s) => {
      if (s.image_url) loadImage(imageUrl(assetUrl(s.image_url)));
    });
  }, [scenes, preload, imageUrl]);

  if (!scenes.length) return null;
  const scene = scenes[index] ?? scenes[last];
  const beforeScene = scenes[Math.min(beforeIndex, last)];

  const comparison = (
    <div className="compare">
      <figure>
        <img src={imageUrl(assetUrl(beforeScene.image_url))} alt={`Site on ${beforeScene.date}`} />
        <figcaption>
          <select
            value={Math.min(beforeIndex, last)}
            onChange={(e) => setBeforeIndex(Number(e.target.value))}
            aria-label="Before date"
          >
            {scenes.map((s, i) => (
              <option key={s.date} value={i}>
                {s.date}
                {dateLabel?.(s) ?? ""}
              </option>
            ))}
          </select>
        </figcaption>
      </figure>
      <figure>
        <img src={imageUrl(assetUrl(scene.image_url))} alt={`Site on ${scene.date}`} />
        <figcaption className="small">{scene.date} (slider)</figcaption>
      </figure>
    </div>
  );
  return (
    <section className={docked ? "scenes scenes-docked" : "panel scenes"} aria-label="NISAR images">
      <h3 className={docked ? "visually-hidden" : undefined}>{title}</h3>
      <div className="scene-player">
        <div className="scene-caption">
          <strong>{scene.date}</strong>
          {scene.quality && (
            <span className={`badge badge-${scene.quality}`}>
              {scene.quality}
            </span>
          )}
          <span className="muted small">
            pass {index + 1} of {scenes.length}
          </span>
        </div>
        <div className="scene-controls">
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => setPlaying((p) => !p)}
            aria-pressed={playing}
          >
            {playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <span className="scene-slider">
            <input
              type="range"
              min={0}
              max={last}
              value={index}
              aria-label="Scene date"
              aria-valuetext={scene.date}
              onChange={(e) => {
                setPlaying(false);
                onIndexChange(Number(e.target.value));
              }}
            />
            {guide?.map((g) => (
              <button
                key={g.index}
                type="button"
                className="scene-guide"
                style={{ "--f": last > 0 ? g.index / last : 0 }}
                title={`Show ${g.label}`}
                aria-label={`Show ${g.label}`}
                onClick={() => {
                  setPlaying(false);
                  onIndexChange(g.index);
                }}
              />
            ))}
          </span>
        </div>
        <LayerSelect layers={layers} value={layer} onChange={onLayerChange} />
        <label className="small opacity">
          <span>{docked ? "Opacity" : "Map overlay opacity"}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={opacity}
            aria-label="Map overlay opacity"
            onChange={(e) => onOpacityChange(Number(e.target.value))}
          />
        </label>
        {!docked && (
          <Legend product={product} imageRange={imageRange} ramp={ramp} text={legend} />
        )}
        {!docked && legendExtra}
        {note && <div className="scene-note small">{note}</div>}
      </div>
      {docked ? (
        <details
          className="scene-comparison"
          onToggle={(event) => setComparisonOpen(event.currentTarget.open)}
        >
          <summary aria-label="Compare passes and view legend">Compare</summary>
          {comparisonOpen && (
            <div className="scene-comparison-body">
              <Legend product={product} imageRange={imageRange} ramp={ramp} text={legend} />
              {legendExtra}
              {comparison}
            </div>
          )}
        </details>
      ) : (
        <>
          <h3>Before / after</h3>
          {comparison}
        </>
      )}
    </section>
  );
}
