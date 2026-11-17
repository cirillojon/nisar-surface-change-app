// A stand-in for the workspace around the catalog panels: it owns the search
// and explorer state as WorkspaceApp does (useAreaCatalog), provides it to
// GranulePanel / DataExplorer, and reports what the workspace would read from
// it: the results, the map layers and the area's series for the evidence card.
import { useEffect, useState } from "react";

import { CatalogContext } from "../components/catalog/CatalogContext.js";
import DataExplorer from "../components/DataExplorer.jsx";
import { useAreaCatalog } from "../workspace/useAreaCatalog.js";

export function CatalogHarness({
  bbox = [0, 0, 1, 1],
  defaultProduct = "GCOV",
  lockedProduct = null,
  imagery = null,
  initialSearch = null,
  open = true,
  onResults = () => {},
  onMapLayers = () => {},
  onAreaSeries = () => {},
  children,
}) {
  const [search, setSearch] = useState(initialSearch);
  const [explorer, setExplorer] = useState(null);
  const catalog = useAreaCatalog({
    target: open ? { bbox, defaultProduct, imagery, lockedProduct } : null,
    search,
    explorer,
    setSearch,
    setExplorer,
    opacity: 0.85,
  });
  const { granules } = catalog.results;
  useEffect(() => onResults(granules), [granules, onResults]);
  useEffect(() => onMapLayers(catalog.mapLayers), [catalog.mapLayers, onMapLayers]);
  const observation = JSON.stringify(catalog.observation ?? null);
  useEffect(() => onAreaSeries(JSON.parse(observation)), [observation, onAreaSeries]);
  return (
    <CatalogContext.Provider value={catalog}>
      {typeof children === "function" ? children(catalog) : children}
    </CatalogContext.Provider>
  );
}

/** The explorer as GranulePanel shows it: once there are results, afresh for each set. */
export function ExplorerHarness({ timelineHost, pick = null, ...props }) {
  return (
    <CatalogHarness {...props}>
      {(catalog) => (
        <>
          {catalog.shown && (
            <DataExplorer key={catalog.ui.key} opacity={0.85} onOpacityChange={() => {}} timelineHost={timelineHost} />
          )}
          {pick && (
            <button type="button" onClick={() => catalog.actions.selectDate(pick.date, pick.id)}>
              Pick from the list
            </button>
          )}
        </>
      )}
    </CatalogHarness>
  );
}
