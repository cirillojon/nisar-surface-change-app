import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import MaturityBadge from "../components/MaturityBadge.jsx";
import TimeSeriesChart from "../components/TimeSeriesChart.jsx";
import { assessPass, summarizeSeries, tierOf } from "../services/maturity.js";
import { lookGeometry, signalWords } from "../services/uncertainty.js";

describe("release tiers", () => {
  it("reads labels and collection names, including validated names without the word", () => {
    expect(tierOf("provisional")).toBe("provisional");
    expect(tierOf("NISAR_L2_GCOV_BETA_V1")).toBe("beta");
    expect(tierOf("NISAR_L2_GCOV_V1")).toBe("validated");
    expect(tierOf("good")).toBe("unknown");
  });

  it("flags reprocessing, the gap and urgent response", () => {
    const a = assessPass({ quality: "provisional", date: "2026-08-01", urgentResponse: true });
    expect(a.superseded_by_reprocessing).toBe(true);
    expect(a.in_gap).toBe(true);
    expect(a.notes.join(" ")).toMatch(/30 days/);
    expect(assessPass({ quality: "validated", date: "2026-11-02" }).notes).toHaveLength(1);
  });

  it("prefers the backend's assessment when present", () => {
    const maturity = { tier: "beta", notes: ["x"], superseded_by_reprocessing: false };
    expect(assessPass({ quality: "validated", maturity })).toBe(maturity);
  });

  it("summarises a mixed series spanning the gap", () => {
    const s = summarizeSeries([
      { date: "2026-07-08", quality: "provisional" },
      { date: "2026-10-24", quality: "validated" },
    ]);
    expect(s.counts).toEqual({ provisional: 1, validated: 1 });
    expect(s.mixed && s.spansGap).toBe(true);
    expect(s.superseded).toBe(1);
  });
});

describe("MaturityBadge", () => {
  it("shows the tier, the reprocessing flag and readable notes", () => {
    render(<MaturityBadge quality="provisional" date="2026-06-01" />);
    expect(screen.getByText("provisional")).toBeInTheDocument();
    expect(screen.getByText("↻ 2027")).toBeInTheDocument();
    expect(screen.getByText(/2027 reprocessing/)).toBeInTheDocument();
  });

  it("drops the flag for validated passes after the cut-over", () => {
    render(<MaturityBadge quality="validated" date="2026-11-02" />);
    expect(screen.queryByText("↻ 2027")).not.toBeInTheDocument();
  });
});

describe("TimeSeriesChart gap band", () => {
  const points = (dates) => dates.map((date, i) => ({ date, value: i }));
  it("hatches the acquisition gap when the series spans it", () => {
    render(
      <TimeSeriesChart
        title="t"
        series={[{ id: "a", label: "A", points: points(["2026-07-01", "2026-09-01"]) }]}
      />,
    );
    expect(screen.getByTestId("chart-gap")).toBeInTheDocument();
  });
  it("draws nothing when it does not", () => {
    render(
      <TimeSeriesChart
        title="t"
        series={[{ id: "a", label: "A", points: points(["2026-10-01", "2026-11-01"]) }]}
      />,
    );
    expect(screen.queryByTestId("chart-gap")).not.toBeInTheDocument();
  });
});

describe("uncertainty words", () => {
  it("always pairs the words with the ratio", () => {
    expect(signalWords(3, 2)).toMatch(/^1\.5× the ±2 mm noise: within the noise/);
    expect(signalWords(-5, 2)).toMatch(/possibly real/);
    expect(signalWords(-40, 2)).toMatch(/^20× .*clearly above/);
    expect(signalWords(null, 2)).toBeNull();
  });

  it("places a left-looking radar east of an ascending track", () => {
    expect(lookGeometry("Ascending", "Left", [30, 40, 35])).toEqual({ from: "east", tilt: 35 });
    expect(lookGeometry("Descending", "Left", [])).toEqual({ from: "west", tilt: null });
    expect(lookGeometry(null, "Left", [])).toBeNull();
  });
});
