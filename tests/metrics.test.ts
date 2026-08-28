import { describe, expect, it } from "vitest";
import { mergeSummary, percentile, summarize, type RollingSample } from "@/lib/metrics";

describe("percentile", () => {
  it("handles empty and single-element inputs", () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([42], 95)).toBe(42);
  });
  it("interpolates", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(xs, 50)).toBeCloseTo(5.5, 5);
    expect(percentile(xs, 100)).toBe(10);
  });
});

describe("summarize", () => {
  it("counts successes / failures / timeouts and status codes", () => {
    const samples: RollingSample[] = [
      { latencyMs: 10, ok: true, timedOut: false, errored: false, status: 200 },
      { latencyMs: 20, ok: true, timedOut: false, errored: false, status: 204 },
      { latencyMs: 30, ok: false, timedOut: false, errored: false, status: 500 },
      { latencyMs: 40, ok: false, timedOut: true, errored: false, status: null },
      { latencyMs: 50, ok: false, timedOut: false, errored: true, status: null },
    ];
    const b = summarize(samples, new Date(), 1000, 3);
    expect(b.requests).toBe(5);
    expect(b.successes).toBe(2);
    expect(b.failures).toBe(3);
    expect(b.timeouts).toBe(1);
    expect(b.errors).toBe(1);
    expect(b.requestsPerSecond).toBe(5);
    expect(b.statusCounts).toEqual({ "200": 1, "204": 1, "500": 1 });
  });
});

describe("mergeSummary", () => {
  it("aggregates buckets and computes overall percentiles", () => {
    const b1 = summarize(
      [{ latencyMs: 10, ok: true, timedOut: false, errored: false, status: 200 }],
      new Date(),
      1000,
      1,
    );
    const b2 = summarize(
      [{ latencyMs: 30, ok: false, timedOut: false, errored: false, status: 503 }],
      new Date(),
      1000,
      1,
    );
    const s = mergeSummary([b1, b2], [10, 30], 2000);
    expect(s.totalRequests).toBe(2);
    expect(s.successes).toBe(1);
    expect(s.failures).toBe(1);
    expect(s.avgRps).toBe(1);
    expect(s.statusCounts).toEqual({ "200": 1, "503": 1 });
  });
});
