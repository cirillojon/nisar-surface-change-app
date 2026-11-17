import "@testing-library/jest-dom/vitest";

// TanStack Query passes results on in a setTimeout(0) batch; in tests, pass
// them on at once, so act() flushes them and fake timers don't hold them back.
import { notifyManager } from "@tanstack/react-query";

notifyManager.setScheduler((callback) => callback());

// jsdom has <dialog> but not its methods: open and close it as browsers do.
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal ??= function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.show ??= function show() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function close() {
    this.removeAttribute("open");
  };
}

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
