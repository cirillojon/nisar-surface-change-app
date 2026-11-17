import { useEffect, useRef, useState } from "react";
import { ImageryLayer, Rectangle, SingleTileImageryProvider } from "cesium";

import { clipToCanvas } from "../../services/globe.js";

/**
 * One image laid over its [west, south, east, north] box, under the place
 * names. A new `url` loads first and then replaces the old one, so a
 * time-lapse swaps passes without the image blinking out.
 */
export function GlobeImage({ globe, url, bbox, opacity = 1 }) {
  const { widget, labels } = globe;
  const shown = useRef(null);
  const alpha = useRef(opacity);
  const box = bbox.join(",");
  useEffect(() => {
    let cancelled = false;
    const [w, s, e, n] = box.split(",").map(Number);
    SingleTileImageryProvider.fromUrl(url, { rectangle: Rectangle.fromDegrees(w, s, e, n) })
      .then((provider) => {
        if (cancelled || widget.isDestroyed()) return;
        const layers = widget.imageryLayers;
        const layer = new ImageryLayer(provider, { alpha: alpha.current });
        layers.add(layer, layers.indexOf(labels));
        if (shown.current) layers.remove(shown.current, true);
        shown.current = layer;
        widget.scene.requestRender();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [widget, labels, url, box]);
  useEffect(() => {
    alpha.current = opacity;
    if (shown.current) shown.current.alpha = opacity;
    widget.scene.requestRender();
  }, [widget, opacity]);
  useEffect(
    () => () => {
      if (shown.current && !widget.isDestroyed()) widget.imageryLayers.remove(shown.current, true);
      shown.current = null;
    },
    [widget],
  );
  return null;
}

/** A catalog tile, clipped to where its pass imaged (as on the 2D map) once its image has loaded. */
export function GlobeRegionTile({ globe, tile, opacity }) {
  const [clipped, setClipped] = useState(null);
  const clip = tile.clip;
  useEffect(() => {
    if (!clip) return undefined;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        setClipped({ from: tile.url, url: clipToCanvas(img, tile.bounds, clip) });
      } catch {
        // No CORS: the image can't be read back, so it shows unclipped.
        setClipped({ from: tile.url, url: tile.url });
      }
    };
    img.src = tile.url;
    return () => {
      cancelled = true;
    };
  }, [tile.url, tile.bounds, clip]);
  const url = !clip ? tile.url : clipped?.from === tile.url ? clipped.url : null;
  if (!url) return null;
  return <GlobeImage globe={globe} url={url} bbox={tile.bounds} opacity={opacity} />;
}
