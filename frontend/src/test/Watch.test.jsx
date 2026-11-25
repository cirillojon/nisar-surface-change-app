import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen, waitFor } from "./render.jsx";

vi.mock("../services/api.js", () => ({
  API_BASE: "",
  assetUrl: (p) => p,
  createWatch: vi.fn(),
  fetchWatch: vi.fn(),
  checkWatch: vi.fn(),
  deleteWatch: vi.fn(),
}));

import WatchButton from "../components/WatchButton.jsx";
import WatchPage from "../platform/WatchPage.jsx";
import { createWatch, deleteWatch, fetchWatch } from "../services/api.js";
import { forgetWatch, listWatches, rememberWatch } from "../services/watches.js";

const ID = "abcdefgh12345678";
const WATCH = {
  id: ID,
  name: "Langtang valley",
  created_at: "2026-11-20T10:00:00+00:00",
  last_checked: "2026-11-25T10:00:00+00:00",
  area: { lat: 28.2, lon: 85.6, half_km: 5, clipped: false },
  frame: "119_A_037",
  refresh_hours: 12,
  feed_url: `/api/watches/${ID}/feed.atom`,
  disclaimer: "Informational, not a warning.",
  status: { state: "idle" },
  passes: [
    { date: "2026-08-19", quality: "provisional", image_url: "/a.webp", stats: { water_pct: 1.2 } },
    { date: "2026-08-31", quality: "provisional", image_url: "/b.webp", stats: { water_pct: 1.1 } },
  ],
  candidates: [
    { kind: "patch", metric: "hh_db", start: "2026-08-19", end: "2026-08-31", status: "accepted",
      headline: "A 0.4 km² patch turned darker", explanation: "Held on the next pass. Worth an expert's look." },
    { kind: "step", metric: "water_pct", start: "2026-08-19", end: "2026-08-31", status: "rejected",
      headline: "Sudden change in open water", explanation: "Not flagged: within the series' own noise." },
  ],
  log: [
    { at: "2026-11-20T10:00:00+00:00", kind: "created", title: "Started watching Langtang valley" },
    { at: "2026-11-25T10:00:00+00:00", kind: "change", title: "A 0.4 km² patch turned darker" },
  ],
};

function at(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/watch" element={<WatchPage />} />
        <Route path="/watch/:id" element={<WatchPage />} />
        <Route path="/workspace" element={<p>workspace</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.clearAllMocks());

describe("remembered watches", () => {
  it("keeps newest first without duplicates, and forgets", () => {
    rememberWatch({ id: "a", name: "A" });
    rememberWatch({ id: "b", name: "B" });
    rememberWatch({ id: "a", name: "A2" });
    expect(listWatches().map((w) => w.name)).toEqual(["A2", "B"]);
    forgetWatch("a");
    expect(listWatches().map((w) => w.id)).toEqual(["b"]);
  });
});

describe("WatchButton", () => {
  it("starts a watch for the box, remembers it and opens its page", async () => {
    createWatch.mockResolvedValue({ id: ID, name: "Here", created_at: "x" });
    fetchWatch.mockResolvedValue(WATCH);
    render(
      <MemoryRouter initialEntries={["/workspace"]}>
        <Routes>
          <Route path="/workspace" element={<WatchButton bbox={[1, 2, 3, 4]} name="Here" />} />
          <Route path="/watch/:id" element={<WatchPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /watch this area/i }));
    expect(createWatch).toHaveBeenCalledWith({ bbox: [1, 2, 3, 4], name: "Here" });
    expect(await screen.findByRole("heading", { name: "Langtang valley" })).toBeInTheDocument();
    expect(listWatches()[0].id).toBe(ID);
  });

  it("shows why it couldn't start", async () => {
    createWatch.mockRejectedValue({ message: "Watching needs a NASA Earthdata Login" });
    render(
      <MemoryRouter>
        <WatchButton bbox={[1, 2, 3, 4]} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /watch this area/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Earthdata");
  });
});

describe("WatchPage", () => {
  it("shows flagged changes first, rejected ones with reasons, passes and history", async () => {
    fetchWatch.mockResolvedValue(WATCH);
    at(`/watch/${ID}`);
    expect(await screen.findByRole("heading", { name: "Langtang valley" })).toBeInTheDocument();
    expect(screen.getByText("Flagged")).toBeInTheDocument();
    expect(screen.getByText(/Looked at and not flagged \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Not flagged: within/)).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByText("Informational, not a warning.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Atom feed/ })).toHaveAttribute(
      "href",
      `${window.location.origin}/api/watches/${ID}/feed.atom`,
    );
    expect(listWatches()[0].id).toBe(ID);
  });

  it("says when a check is running", async () => {
    fetchWatch.mockResolvedValue({ ...WATCH, status: { state: "running" }, passes: [], candidates: [] });
    at(`/watch/${ID}`);
    expect(await screen.findByText(/Checking NISAR passes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check now" })).toBeDisabled();
  });

  it("stops watching after confirmation", async () => {
    fetchWatch.mockResolvedValue(WATCH);
    deleteWatch.mockResolvedValue(null);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    rememberWatch(WATCH);
    at(`/watch/${ID}`);
    fireEvent.click(await screen.findByRole("button", { name: /stop watching/i }));
    await waitFor(() => expect(deleteWatch).toHaveBeenCalledWith(ID));
    expect(await screen.findByRole("heading", { name: "Your watched areas" })).toBeInTheDocument();
    expect(listWatches()).toEqual([]);
  });

  it("lists this browser's watches", () => {
    rememberWatch({ id: ID, name: "Langtang valley" });
    at("/watch");
    expect(screen.getByRole("link", { name: "Langtang valley" })).toHaveAttribute("href", `/watch/${ID}`);
  });

  it("explains a missing watch", async () => {
    fetchWatch.mockRejectedValue({ status: 404, message: "watch not found" });
    at(`/watch/${ID}`);
    expect(await screen.findByText(/doesn't exist, or it was stopped/)).toBeInTheDocument();
  });
});
