/* Docs page loaders. Pages are MDX files at src/content/docs/<tab>/<slug>.mdx,
 * loaded on demand (one chunk per page). Each file exports `meta`
 * ({ title, description }) alongside its default component. */

const pages = import.meta.glob("../../content/docs/*/*.mdx");
// Plain source text for search (see the plain-text plugin in vite.config.js).
const raw = import.meta.glob("../../content/docs/*/*.mdx", { query: "?plain", import: "default" });

const keyOf = (path) => path.replace("../../content/docs/", "").replace(/\.mdx$/, "");

const loaders = Object.fromEntries(Object.entries(pages).map(([p, load]) => [keyOf(p), load]));
const rawLoaders = Object.fromEntries(Object.entries(raw).map(([p, load]) => [keyOf(p), load]));
const loadedPages = new Map();

export function hasPage(tabId, slug) {
  return `${tabId}/${slug}` in loaders;
}

export function loadPage(tabId, slug) {
  const key = `${tabId}/${slug}`;
  if (!loadedPages.has(key)) {
    loadedPages.set(key, loaders[key]?.() ?? Promise.resolve(null));
  }
  return loadedPages.get(key);
}

/** Raw text of every page, for search: [{ key, text }]. */
export async function loadAllRaw() {
  const entries = await Promise.all(
    Object.entries(rawLoaders).map(async ([key, load]) => ({ key, text: await load() })),
  );
  return entries;
}
