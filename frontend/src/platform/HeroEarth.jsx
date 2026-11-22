import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { heroGlobeLayout } from "./earth/hero-globe-layout.js";
import { bindHomeDescent, COMPACT_DESCENT_QUERY } from "./earth/home-descent.js";
import "./earth/hero-earth.css";

const DESCENT_FOCUS = 0.92;

export default function HeroEarth({ landing }) {
  const host = useRef(null);
  const renderer = useRef(null);
  const target = useRef(null);
  const [unavailable, setUnavailable] = useState(false);

  useLayoutEffect(() => {
    target.current = landing;
    renderer.current?.setDescentTarget(landing);
  }, [landing]);

  useEffect(() => {
    const element = host.current;
    element.style.setProperty("--earth-focus", `${DESCENT_FOCUS * 100}%`);
    let canceled = false;
    let view = { zoom: 1, alignment: 0, visible: true, clipTop: 0 };
    const applyView = (instance, scrollFrameTime) => {
      instance.setSuspended(!view.visible);
      if (view.visible) instance.setDescentView(view.zoom, view.alignment, scrollFrameTime, view.clipTop);
    };
    const hero = element.closest(".pf-hero");
    const stopDescent = hero && bindHomeDescent(hero, (zoom, alignment, visible, scrollFrameTime, clipTop = 0) => {
      view = { zoom, alignment, visible, clipTop };
      if (renderer.current) applyView(renderer.current, scrollFrameTime);
    });
    const resize = () => {
      const { x, y, radius } = heroGlobeLayout(element.clientWidth, element.clientHeight);
      element.style.setProperty("--earth-radius", `${radius}px`);
      element.style.setProperty("--earth-center-x", `${x}px`);
      element.style.setProperty("--earth-center-y", `${y}px`);
    };
    resize();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    observer?.observe(element);

    // Keep Three and its textures out of the initial application bundle.
    import("./earth/earth-hero").then(async ({ createEarthHero }) => {
      if (canceled) return;
      const instance = createEarthHero(element, {
        assetBase: `${import.meta.env.BASE_URL}earth`,
        loadReference: false,
        quality: window.matchMedia?.(COMPACT_DESCENT_QUERY)?.matches ? "low" : "auto",
        layout: heroGlobeLayout,
        descentFocus: DESCENT_FOCUS,
        descentTarget: target.current,
        onChange: ({ contextLost }) => {
          if (!canceled) setUnavailable(contextLost === true);
        },
      });
      renderer.current = instance;
      if (view.zoom > 1 || view.alignment > 0 || !view.visible) applyView(instance);
      await instance.ready;
    }).catch(() => { if (!canceled) setUnavailable(true); });

    return () => {
      canceled = true;
      stopDescent?.();
      observer?.disconnect();
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, []);

  return (
    <div className="pf-hero-earth">
      <div className="pf-hero-earth-visual">
        <div ref={host} className="pf-hero-earth-mount">
          {unavailable && (
            <div className="pf-hero-earth-poster-view" aria-hidden="true">
              <img className="pf-hero-earth-poster" src={`${import.meta.env.BASE_URL}earth/reference.png`} alt="" />
            </div>
          )}
        </div>
      </div>
      {unavailable && <span className="pf-hero-earth-status" role="status">Earth preview</span>}
    </div>
  );
}
