import { createContext, useContext } from "react";

/**
 * The open catalog search, shared by the workspace (which puts its images on
 * the map and its series in the evidence card) and the panels that show it
 * (GranulePanel, DataExplorer). See workspace/useAreaCatalog.js.
 */
export const CatalogContext = createContext(null);

export function useCatalogContext() {
  const catalog = useContext(CatalogContext);
  if (!catalog) throw new Error("No catalog search is open (CatalogContext missing).");
  return catalog;
}
