import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { heroGlobeLayout } from "./earth/hero-globe-layout.js";
import { bindHomeDescent } from "./earth/home-descent.js";
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
    let cancelled = false;
    let descentZoom = 1;
    let descentAlignment = 0;
    const hero = element.closest(".pf-hero");
    const stopDescent = hero && bindHomeDescent(hero, (zoom, alignment) => {
      descentZoom = zoom;
      descentAlignment = alignment;
      renderer.current?.setDescentView(zoom, alignment);
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
      if (cancelled) return;
      const instance = createEarthHero(element, {
        assetBase: `${import.meta.env.BASE_URL}earth`,
        loadReference: false,
        layout: heroGlobeLayout,
        descentFocus: DESCENT_FOCUS,
        descentTarget: target.current,
        onChange: ({ contextLost }) => {
          if (!cancelled) setUnavailable(contextLost === true);
        },
      });
      renderer.current = instance;
      if (descentZoom > 1) instance.setDescentView(descentZoom, descentAlignment);
      await instance.ready;
    }).catch(() => { if (!cancelled) setUnavailable(true); });

    return () => {
      cancelled = true;
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
