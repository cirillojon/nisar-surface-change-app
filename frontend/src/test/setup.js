import "@testing-library/jest-dom/vitest";

// Newer Node versions define their own `localStorage` global, which hides jsdom's
// and leaves `window.localStorage` undefined. Provide a plain in-memory one then.
if (typeof window !== "undefined" && !window.localStorage) {
  const data = new Map();
  const storage = {
    getItem: (k) => (data.has(String(k)) ? data.get(String(k)) : null),
    setItem: (k, v) => void data.set(String(k), String(v)),
    removeItem: (k) => void data.delete(String(k)),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  };
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}
