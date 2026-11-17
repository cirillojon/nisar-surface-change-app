import { act, fireEvent, render, screen, waitFor, within } from "./render.jsx";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import LandChangePanel from "../components/LandChangePanel.jsx";
import LandPlayer from "../components/LandPlayer.jsx";
import { useLandPlayer } from "../components/land/useLandPlayer.js";
import PlacesList from "../components/PlacesList.jsx";
import { boxBlur, changeMap, createChangeMaps, toDb } from "../services/landchange.js";
import { PLAY_MS } from "../services/usePlayback.js";

const pass = (date) => ({
  date,
  quality: "provisional",
  image_url: `/api/scenes/landchange/kilauea/${date}.webp`,
  hh_url: `/api/scenes/landchange/kilauea/${date}.hh.png`,
});

const site = {
  slug: "kilauea",
  name: "Kīlauea summit",
  region: "Hawaiʻi, USA",
  kind: "Volcano",
  status: "visible",
  headline: "Lava refills Halemaʻumaʻu crater",
  story: "Episodes of fountaining.",
  look_for: "The crater floor changing texture.",
  bbox: [-155.31, 19.38, -155.25, 19.43],
  frame: "072_D_079",
  pixel_m: 20,
  suggested: ["2025-11-03", "2026-11-10"],
  passes: [pass("2025-11-03"), pass("2026-05-01"), pass("2026-11-10")],
  sources: [{ label: "USGS HVO", url: "https://www.usgs.gov/hvo" }],
  db_range: [-30, 5],
};

describe("change maps", () => {
  it("decodes the 8-bit dB layer", () => {
    expect(toDb(0)).toBe(-30);
    expect(toDb(254)).toBe(5);
    expect(toDb(255)).toBeNaN();
  });

  it("smooths while ignoring missing pixels", () => {
    const out = boxBlur(Float64Array.from([1, NaN, 3]), 3, 1, 1);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  it("colours brighter red, darker blue, and leaves no-data clear", () => {
    // 3 x 1: brighter by ~8 dB, unchanged, then no data on one date.
    const before = Uint8Array.from([100, 100, 100]);
    const after = Uint8Array.from([158, 100, 255]);
    const { rgba, changedPct } = changeMap(before, after, 3, 1, { radius: 0, removeShift: false });
    expect(Array.from(rgba.slice(0, 4))).toEqual([178, 24, 43, 255]); // clipped at +6 dB: full red
    expect(Array.from(rgba.slice(4, 8))).toEqual([245, 245, 245, 255]);
    expect(rgba[11]).toBe(0); // transparent
    expect(changedPct).toBe(50); // 1 of the 2 measured pixels changed > 4 dB
    const darker = changeMap(Uint8Array.from([158]), Uint8Array.from([100]), 1, 1, { radius: 0, removeShift: false });
    expect(Array.from(darker.rgba)).toEqual([33, 102, 172, 255]);
  });
});

describe("change map refinements", () => {
  it("removes the area-wide shift so local change stands out", () => {
    // Everything brightens by ~2 dB; one pixel by ~8 dB.
    const before = Uint8Array.from([100, 100, 100, 100, 100]);
    const after = Uint8Array.from([115, 115, 115, 115, 158]);
    const raw = changeMap(before, after, 5, 1, { radius: 0, removeShift: false });
    const local = changeMap(before, after, 5, 1, { radius: 0 });
    expect(raw.shift).toBe(0);
    expect(local.shift).toBeCloseTo(2.07, 1);
    // Raw: the 2 dB pixels are tinted; with the shift removed they're neutral.
    expect(Array.from(raw.rgba.slice(0, 3))).not.toEqual([245, 245, 245]);
    expect(Array.from(local.rgba.slice(0, 3))).toEqual([245, 245, 245]);
    expect(local.changedPct).toBe(20); // only the real change remains
  });

  it("leaves open water out of the share of land that changed", () => {
    // Pixel 0: water that stays dark (below -18 dB) but brightens ~5.5 dB
    // with wind; pixel 1: land, unchanged.
    const before = Uint8Array.from([30, 150]); // about -25.9 dB
    const after = Uint8Array.from([70, 150]); // about -20.4 dB
    const { changedPct } = changeMap(before, after, 2, 1, { radius: 0, removeShift: false });
    expect(changedPct).toBe(0);
  });
});

describe("createChangeMaps", () => {
  const layer = (v) => ({ values: Uint8Array.from([v, v, v, v]), width: 2, height: 2 });
  const a = { date: "2025-11-03", hh_url: "/a.hh.png" };
  const b = { date: "2026-05-01", hh_url: "/b.hh.png" };

  it("builds each pair once, names the dates it compares, and keeps what it built", async () => {
    const load = vi.fn((url) => Promise.resolve(layer(url === "/a.hh.png" ? 100 : 158)));
    const draw = vi.fn(() => "data:image/png;base64,MAP");
    const maps = createChangeMaps({ load, draw });
    expect(maps.peek(a, b)).toBeUndefined();
    const [first, again] = await Promise.all([maps.get(a, b), maps.get(a, b)]);
    expect(first).toBe(again);
    expect(first).toMatchObject({ url: "data:image/png;base64,MAP", from: "2025-11-03", to: "2026-05-01" });
    expect(maps.peek(a, b)).toBe(first);
    expect(draw).toHaveBeenCalledTimes(1);
    // The other shift setting is a different map, built from the same downloads.
    expect((await maps.get(a, b, false)).changedPct).toBe(100);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reports a failure without keeping it, so the next try can work", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(layer(100));
    const maps = createChangeMaps({ load, draw: () => "data:," });
    expect(await maps.get(a, b)).toEqual({ error: "Couldn't build the change map in this browser." });
    expect(maps.peek(a, b)).toBeUndefined();
    expect((await maps.get(a, b)).url).toBe("data:,");
    expect(await maps.get(a, { date: "2026-06-01" })).toEqual({ error: "These passes have no HH layer." });
  });
});

describe("<PlacesList />", () => {
  const props = {
    loading: false,
    sites: [
      { id: 1, name: "Punjab", change_type: "agriculture", scene_count: 26, first_date: "2025-11-21", last_date: "2026-11-04", thumb_url: "/api/scenes/punjab/2026-11-04.webp" },
      { id: 2, name: "New basin", change_type: "subsidence", scene_count: 0 },
    ],
    changeTypes: [{ id: "agriculture", label: "Crops & farming", color: "#0f0" }],
    landSites: [
      site,
      { ...site, slug: "langtang", name: "Langtang", status: "likely" },
      { slug: "home-reef", name: "Home Reef", region: "Tonga", status: "not_visible", reason: "Looks the same." },
    ],
    onSelectSite: () => {},
    onSelectLand: () => {},
  };

  it("lists every place with data in one list: measured sites, then before & after places", () => {
    const onSelectSite = vi.fn();
    const onSelectLand = vi.fn();
    render(<PlacesList {...props} selectedSiteId={1} onSelectSite={onSelectSite} onSelectLand={onSelectLand} />);
    const measured = screen.getByRole("region", { name: "Measured over time" });
    const punjab = within(measured).getByRole("button", { name: /Punjab/ });
    expect(punjab).toHaveAccessibleName("Punjab Crops & farming · 26 passes");
    expect(punjab).toHaveAttribute("aria-current", "true");
    expect(punjab).toHaveAttribute("title", "Nov 2025 – Nov 2026");
    expect(within(measured).getByText(/No NISAR data yet/)).toBeInTheDocument();
    fireEvent.click(punjab);
    expect(onSelectSite).toHaveBeenCalledWith(1);

    const gallery = screen.getByRole("region", { name: "Before & after" });
    fireEvent.click(within(gallery).getByRole("button", { name: /Kīlauea summit/ }));
    expect(onSelectLand).toHaveBeenCalledWith("kilauea");
    // Only a place whose change isn't confirmed is flagged.
    expect(within(gallery).getAllByText("Likely: verify")).toHaveLength(1);
    expect(within(gallery).getByText(/1 more places checked/)).toBeInTheDocument();
    expect(within(gallery).getByText(/Looks the same\./)).toBeInTheDocument();
  });

  it("pictures each place with one of its own passes", () => {
    const { container } = render(<PlacesList {...props} />);
    const thumbs = [...container.querySelectorAll("img.place-thumb")].map((img) => img.getAttribute("src"));
    expect(thumbs).toEqual([
      "/api/scenes/punjab/2026-11-04.webp",
      // A gallery place: its suggested "after" pass.
      "/api/scenes/landchange/kilauea/2026-11-10.webp",
      "/api/scenes/landchange/kilauea/2026-11-10.webp",
    ]);
  });

  it("says so while the lists load, or when nothing could be loaded", () => {
    const { rerender } = render(<PlacesList {...props} loading sites={[]} landSites={null} />);
    expect(screen.getAllByRole("status").map((s) => s.textContent)).toEqual(["Loading sites…", "Loading places…"]);
    rerender(<PlacesList {...props} sites={[]} landSites={[]} />);
    expect(screen.getByText("No study sites could be loaded.")).toBeInTheDocument();
    expect(screen.getByText(/No before & after places/)).toBeInTheDocument();
  });
});

describe("<LandChangePanel />", () => {
  it("describes the place and leaves the dates and layers to the dock", () => {
    const onBack = vi.fn();
    const onToggleChange = vi.fn();
    const { rerender } = render(<LandChangePanel site={site} onBack={onBack} onToggleChange={onToggleChange} />);
    expect(screen.getByText(/Lava refills Halemaʻumaʻu crater\./)).toBeInTheDocument();
    expect(screen.getByText(/The crater floor changing texture\./)).toBeInTheDocument();
    expect(screen.getByText("3 passes · Nov 2025 – Nov 2026 · HH and HV")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "USGS HVO" })).toHaveAttribute("href", "https://www.usgs.gov/hvo");
    // No player here: nothing in the panel changes while a time-lapse runs.
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "← All places" }));
    expect(onBack).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show the change map" }));
    expect(onToggleChange).toHaveBeenCalled();
    rerender(<LandChangePanel site={site} onBack={onBack} onToggleChange={onToggleChange} changeShown />);
    expect(screen.getByRole("button", { name: "Show the images" })).toBeInTheDocument();
  });

  it("flags an unconfirmed place and counts the passes that have HV", () => {
    const partial = {
      ...site,
      status: "likely",
      passes: site.passes.map((p, i) => ({ ...p, polarizations: i === 0 ? "HH" : "HH+HV" })),
    };
    render(<LandChangePanel site={partial} onBack={() => {}} />);
    expect(screen.getByText("Likely: verify")).toBeInTheDocument();
    expect(screen.getByText(/HH; HV on 2 of them/)).toBeInTheDocument();
  });

  it("keeps the image notes and leaves the evidence callout to the story", () => {
    render(<LandChangePanel site={site} onBack={() => {}} onToggleChange={() => {}} embedded />);
    expect(screen.queryByRole("button", { name: "← All places" })).toBeNull();
    expect(screen.getByText(/Lava refills/)).toBeVisible();
    expect(screen.queryByText(/The crater floor changing texture\./)).toBeNull();
    expect(screen.queryByRole("button", { name: "Show the change map" })).toBeNull();
  });
});

/**
 * A stand-in for the workspace around the player: it keeps the place's dates,
 * layer and shift as WorkspaceApp does, and reports the image the workspace
 * would put on the map (`onOverlay`).
 */
const DB_RANGE = [-30, 5];

function LandHarness({ site: place, open = true, layer: chosenLayer = null, onLayerChange, onOverlay = () => {}, loadLayer, toDataUrl }) {
  const [dates, setDates] = useState(null);
  const [ownLayer, setOwnLayer] = useState(null);
  const [removeShift, setRemoveShift] = useState(true);
  const land = useLandPlayer({
    site: open ? place : null,
    dbRange: DB_RANGE,
    dates,
    layer: chosenLayer ?? ownLayer,
    removeShift,
    setDates,
    ...(loadLayer && { loadLayer }),
    ...(toDataUrl && { toDataUrl }),
  });
  useEffect(() => onOverlay(land.overlay), [land.overlay, onOverlay]);
  if (!land.site) return null;
  return (
    <LandPlayer
      player={land}
      opacity={0.85}
      onOpacityChange={() => {}}
      onLayerChange={(id) => {
        setOwnLayer(id);
        onLayerChange?.(id);
      }}
      onRemoveShiftChange={setRemoveShift}
    />
  );
}

describe("<LandPlayer />", () => {
  const layer = (v) => ({ values: Uint8Array.from([v, v, v, v]), width: 2, height: 2 });
  const props = { site };
  const url = (date) => `/api/scenes/landchange/kilauea/${date}.webp`;
  const pickLayer = (id) =>
    fireEvent.change(screen.getByRole("combobox", { name: "Image layer" }), { target: { value: id } });

  it("opens on the suggested pair and puts the slider's pass on the map", () => {
    const onOverlay = vi.fn();
    render(<LandHarness {...props} onOverlay={onOverlay} />);
    expect(screen.getByText("2026-11-10", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("pass 3 of 3")).toBeInTheDocument();
    expect(onOverlay).toHaveBeenLastCalledWith({ url: url("2026-11-10"), bbox: site.bbox });
    fireEvent.change(screen.getByRole("slider", { name: "Scene date" }), { target: { value: "1" } });
    expect(onOverlay).toHaveBeenLastCalledWith({ url: url("2026-05-01"), bbox: site.bbox });
  });

  it("builds a change map since the chosen date and says how much changed", async () => {
    const loadLayer = vi.fn((u) => Promise.resolve(layer(u.includes("2025-11-03") ? 100 : 158)));
    const toDataUrl = vi.fn(() => "data:image/png;base64,CHANGE");
    const onOverlay = vi.fn();
    render(<LandHarness {...props} onOverlay={onOverlay} loadLayer={loadLayer} toDataUrl={toDataUrl} />);
    pickLayer("change");
    expect(screen.getByRole("combobox", { name: "Change since" })).toHaveValue("0");
    // Everything brightened alike, so with the area-wide shift removed nothing is left.
    expect(await screen.findByText(/0\.0% of the land changed by more than 4 dB, after removing an area-wide \+8\.0 dB/)).toBeInTheDocument();
    expect(loadLayer).toHaveBeenCalledWith("/api/scenes/landchange/kilauea/2025-11-03.hh.png");
    await waitFor(() =>
      expect(onOverlay).toHaveBeenLastCalledWith({ url: "data:image/png;base64,CHANGE", bbox: site.bbox }),
    );
    // The legend's switch gives the raw difference back.
    const compare = screen.getByText("Compare").closest("details");
    compare.open = true;
    fireEvent(compare, new Event("toggle"));
    fireEvent.click(screen.getByRole("checkbox", { name: /area-wide shift/ }));
    expect(await screen.findByText(/100\.0% of the land changed by more than 4 dB$/)).toBeInTheDocument();
  });

  it("never blanks the map or the dock while a time-lapse of change maps plays", async () => {
    vi.useFakeTimers();
    try {
      // Each layer takes a while to arrive, longer than a frame is held.
      const loadLayer = vi.fn(
        (u) => new Promise((resolve) => setTimeout(() => resolve(layer(u.includes("2025-11-03") ? 100 : 158)), PLAY_MS * 2)),
      );
      let built = 0;
      const toDataUrl = vi.fn(() => `data:image/png;base64,MAP${(built += 1)}`);
      const onOverlay = vi.fn();
      render(<LandHarness {...props} onOverlay={onOverlay} loadLayer={loadLayer} toDataUrl={toDataUrl} />);
      fireEvent.change(screen.getByRole("slider", { name: "Scene date" }), { target: { value: "1" } });
      pickLayer("change");
      // Until the first map exists, the pass's own image stays on the map.
      expect(onOverlay).toHaveBeenLastCalledWith({ url: url("2026-05-01"), bbox: site.bbox });
      expect(screen.getByText("Building the change map…")).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(PLAY_MS * 2));
      expect(screen.getByText(/of the land changed/)).toBeInTheDocument();

      onOverlay.mockClear();
      fireEvent.click(screen.getByRole("button", { name: /Play/ }));
      // A frame's time passes, but the next map isn't built: the pass shown stays.
      await act(() => vi.advanceTimersByTimeAsync(PLAY_MS));
      expect(screen.getByText("pass 2 of 3")).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(PLAY_MS));
      expect(screen.getByText("pass 3 of 3")).toBeInTheDocument();
      // The loop restarts after the "since" pass, not on it (a map of no change).
      await act(() => vi.advanceTimersByTimeAsync(PLAY_MS));
      expect(screen.getByText("pass 2 of 3")).toBeInTheDocument();
      // The map went straight from one change map to the next, never to nothing.
      expect(onOverlay.mock.calls.map(([overlay]) => overlay?.url)).toEqual([
        "data:image/png;base64,MAP2",
        "data:image/png;base64,MAP1",
      ]);
      expect(screen.queryByText("Building the change map…")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says why when a change map can't be built, and keeps the image on the map", async () => {
    const onOverlay = vi.fn();
    render(<LandHarness {...props} onOverlay={onOverlay} loadLayer={() => Promise.reject(new Error("no canvas"))} />);
    pickLayer("change");
    expect(await screen.findByText(/Couldn't build the change map/)).toBeInTheDocument();
    expect(onOverlay).toHaveBeenLastCalledWith({ url: url("2026-11-10"), bbox: site.bbox });
  });

  it("starts in HH where some passes have no HV, and follows a layer chosen elsewhere", () => {
    const partial = { ...site, passes: site.passes.map((p, i) => ({ ...p, polarizations: i === 0 ? "HH" : "HH+HV" })) };
    const onLayerChange = vi.fn();
    const { rerender } = render(<LandHarness site={partial} onLayerChange={onLayerChange} />);
    expect(screen.getByRole("combobox", { name: "Image layer" })).toHaveValue("hh");
    pickLayer("colour");
    expect(onLayerChange).toHaveBeenCalledWith("colour");
    rerender(<LandHarness site={partial} layer="colour" onLayerChange={onLayerChange} />);
    expect(screen.getByText("Grey frames are passes where only HH was collected.")).toBeInTheDocument();
  });

  it("takes its image off the map when the place closes", () => {
    const onOverlay = vi.fn();
    const { rerender } = render(<LandHarness {...props} onOverlay={onOverlay} />);
    rerender(<LandHarness {...props} open={false} onOverlay={onOverlay} />);
    expect(onOverlay).toHaveBeenLastCalledWith(null);
  });
});
