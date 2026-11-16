/* Image preloading, so the map and players only show frames that are ready. */

// Give up waiting on an image after this long (slow or stuck requests).
export const LOAD_TIMEOUT_MS = 8000;

const cache = new Map(); // url -> promise
// The most recently loaded images stay referenced so the browser keeps them
// decoded; frames that are swapped in then paint without a decode delay.
const KEEP_DECODED = 64;
const decoded = [];

/**
 * Load and decode `url` once; resolves when it's ready to draw, or when it
 * failed or timed out (so callers never wait forever).
 */
export function loadImage(url) {
  if (!url) return Promise.resolve();
  let promise = cache.get(url);
  if (!promise) {
    promise = new Promise((resolve) => {
      const img = new Image();
      const timer = setTimeout(resolve, LOAD_TIMEOUT_MS);
      img.onload = () => {
        clearTimeout(timer);
        // Decode off the main thread so the swap itself is instant.
        (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => {
          decoded.push(img);
          if (decoded.length > KEEP_DECODED) decoded.shift();
          resolve();
        });
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve();
      };
      img.src = url;
    });
    cache.set(url, promise);
  }
  return promise;
}
