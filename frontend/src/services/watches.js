/**
 * The watches this browser started. A watch's id is its private link and the
 * server lists none, so this list (localStorage) is how a visitor finds theirs again.
 */
const KEY = "nisar.watches.v1";

function read() {
  try {
    const list = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((w) => w && typeof w.id === "string") : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Private mode or storage full: the link still works, it just isn't remembered.
  }
}

export const listWatches = () => read();

/** Remember a watch (newest first; an existing entry is refreshed). */
export function rememberWatch({ id, name, created_at: createdAt }) {
  write([{ id, name, createdAt }, ...read().filter((w) => w.id !== id)]);
}

export function forgetWatch(id) {
  write(read().filter((w) => w.id !== id));
}

/** The shareable page for a watch. */
export const watchPath = (id) => `/watch/${id}`;
