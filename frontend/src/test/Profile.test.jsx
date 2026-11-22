import { act, fireEvent, render, screen, waitFor } from "./render.jsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/api.js", () => ({
  startProfile: vi.fn(),
  fetchProfile: vi.fn(),
  assetUrl: (p) => p,
}));

import ProfilePanel from "../components/ProfilePanel.jsx";
import SpaceTimeChart from "../components/SpaceTimeChart.jsx";
import { fetchProfile, startProfile } from "../services/api.js";

const LINE = [
  [-119.95, 36.02],
  [-119.3, 36.22],
];

const result = {
  id: "abc",
  line: LINE,
  length_km: 62.5,
  frame: "034_A_020",
  pass_direction: "Ascending",
  first_date: "2025-11-24",
  last_date: "2025-12-18",
  pairs_total: 2,
  pairs_used: 2,
  chains: 1,
  corrections: "ionosphere + troposphere",
  scatter_mm: { none: 18.1, ionosphere: 12.6, troposphere: 16.9, "ionosphere + troposphere": 10.9 },
  noise_mm: 10.9,
  points: {
    dist_km: [0, 0.2, 0.4],
    lon: [-119.95, -119.948, -119.946],
    lat: [36.02, 36.021, 36.022],
    elevation_m: [60, 62, 64],
    incidence_deg: [40, 40, 40],
    velocity_mm_yr: [-100, 0, 50],
    measured_pct: 100,
  },
  dates: ["2025-11-24", "2025-12-06", "2025-12-18"],
  los_mm: [
    [0, 0, 0],
    [-3, 0, 1.5],
    [-6.5, 0, 3.2],
  ],
  vertical_mm: [
    [0, 0, 0],
    [-4, 0, 2],
    [-8.5, null, 4.2],
  ],
};

describe("<ProfilePanel />", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    startProfile.mockReset();
    fetchProfile.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("starts a job, shows progress, then the result", async () => {
    startProfile.mockResolvedValue({ id: "abc", state: "queued" });
    fetchProfile
      .mockResolvedValueOnce({
        id: "abc",
        state: "running",
        progress: { stage: "Reading NISAR data", done: 7, total: 25, frame: "034_A_020" },
      })
      .mockResolvedValueOnce({ id: "abc", state: "done", result });

    render(<ProfilePanel line={LINE} onBack={() => {}} />);
    expect(startProfile).toHaveBeenCalledWith(LINE);
    expect(await screen.findByText(/7 of 25 interferograms/)).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(await screen.findByRole("heading", { name: "Elevation" })).toBeInTheDocument();
    expect(screen.getByText(/62\.5 km · NISAR frame/)).toBeInTheDocument();
    expect(screen.getByText("2025-12-18", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getAllByTestId("spacetime-row")).toHaveLength(3);
    expect(screen.getByText(/Shaded: ±10\.9 mm/)).toBeInTheDocument();
  });

  it("scrubs dates and switches between height change and line of sight", async () => {
    startProfile.mockResolvedValue({ id: "abc", state: "done" });
    fetchProfile.mockResolvedValue({ id: "abc", state: "done", result });
    render(<ProfilePanel line={LINE} onBack={() => {}} />);
    const slider = await screen.findByRole("slider", { name: "To date" });
    fireEvent.change(slider, { target: { value: "1" } });
    expect(screen.getByText("2025-12-06", { selector: "strong" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId("spacetime-row")[2]);
    expect(screen.getByText("2025-12-18", { selector: "strong" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Along the radar's view" }));
    expect(screen.getByText(/Exactly what NISAR measures/)).toBeInTheDocument();
  });

  it("shows the total change between a chosen From date and the slider's To date", async () => {
    startProfile.mockResolvedValue({ id: "abc", state: "done" });
    fetchProfile.mockResolvedValue({ id: "abc", state: "done", result });
    render(<ProfilePanel line={LINE} onBack={() => {}} />);
    // Default: from the first date to the last. Vertical: -8.5 at 0 km, +4.2 at 0.4 km.
    // Each stands beside the gap at 0.2 km with no measured neighbor, so each is flagged.
    const lone = " (a lone point between gaps: treat with caution)";
    expect(await screen.findByText(/largest drop/)).toHaveTextContent(
      `largest drop -8.5 mm at 0.0 km${lone}, largest rise +4.2 mm at 0.4 km${lone}`,
    );
    expect(screen.getByText(/Shaded: ±10\.9 mm/)).toBeInTheDocument();
    // From the middle date: -8.5 - (-4) = -4.5 and 4.2 - 2 = 2.2; the point
    // missing on the To date drops out.
    fireEvent.change(screen.getByRole("combobox", { name: "From date" }), { target: { value: "1" } });
    expect(screen.getByText(/largest drop/)).toHaveTextContent(
      `largest drop -4.5 mm at 0.0 km${lone}, largest rise +2.2 mm at 0.4 km${lone}`,
    );
    // Two dates' noise.
    expect(screen.getByText(/Shaded: ±15\.4 mm/)).toBeInTheDocument();
    expect(document.querySelector(".chart-baseline")).not.toBeNull();
    // To before From reads as change backwards in time.
    fireEvent.change(screen.getByRole("slider", { name: "To date" }), { target: { value: "0" } });
    expect(screen.getByText(/running backwards in time/)).toBeInTheDocument();
  });

  it("waits for the result when a cached line answers done straight away", async () => {
    startProfile.mockResolvedValue({ id: "abc", state: "done" });
    let deliver;
    fetchProfile.mockReturnValue(new Promise((resolve) => (deliver = resolve)));
    render(<ProfilePanel line={LINE} onBack={() => {}} />);
    await waitFor(() => expect(fetchProfile).toHaveBeenCalled());
    // Start said done, but the result hasn't arrived yet: no crash, still loading.
    expect(screen.getByRole("status")).toBeInTheDocument();
    await act(async () => deliver({ id: "abc", state: "done", result }));
    expect(await screen.findByRole("heading", { name: "Elevation" })).toBeInTheDocument();
  });

  it("shows job and start errors", async () => {
    startProfile.mockResolvedValue({ id: "abc", state: "queued" });
    fetchProfile.mockResolvedValue({ id: "abc", state: "error", error: "No single NISAR track/frame covers this whole line" });
    render(<ProfilePanel line={LINE} onBack={() => {}} />);
    expect(await screen.findByText(/No single NISAR track\/frame/)).toBeInTheDocument();
  });

  it("explains a rejected line", async () => {
    startProfile.mockRejectedValue({ status: 400, message: "line must be at most 100 km long (this one is 140 km)" });
    render(<ProfilePanel line={LINE} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText(/at most 100 km/)).toBeInTheDocument());
    expect(fetchProfile).not.toHaveBeenCalled();
  });
});

describe("<SpaceTimeChart />", () => {
  it("colors cells red for down, blue for up, and leaves gaps blank", () => {
    const { container } = render(
      <SpaceTimeChart
        dist={[0, 1, 2]}
        dates={["2025-11-24", "2025-12-06"]}
        rows={[
          [-10, 0, 10],
          [null, null, 5],
        ]}
        limit={10}
      />,
    );
    const fills = [...container.querySelectorAll("rect")].map((r) => r.getAttribute("fill"));
    expect(fills).toContain("rgb(178,24,43)"); // -10 at the limit: full red
    expect(fills).toContain("rgb(33,102,172)"); // +10: full blue
    // 3 cells on the first date + 1 on the second (two gaps).
    expect(fills.filter(Boolean)).toHaveLength(4);
  });
});
