import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A function that keeps one identity across renders but always runs the
 * latest `fn`: for handlers called from effects or passed to children whose
 * effects depend on them, without stale values or dependency workarounds.
 * (React 19.2's useEffectEvent does this for effects only, and the installed
 * hooks lint rule doesn't know it yet.) Not for calling during render.
 */
export function useStableCallback(fn) {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args) => latest.current(...args), []);
}
