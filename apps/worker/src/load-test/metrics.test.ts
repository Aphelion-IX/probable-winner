import { describe, it, expect } from "vitest";
import { computeStats, type Sample } from "./metrics.js";

function samples(durations: number[], errorIndexes: number[] = []): Sample[] {
  return durations.map((durationMs, i) => ({
    durationMs,
    ok: !errorIndexes.includes(i),
  }));
}

describe("computeStats", () => {
  it("returns zeroed stats for an empty sample set", () => {
    const stats = computeStats([]);
    expect(stats).toEqual({
      count: 0,
      errorCount: 0,
      errorRate: 0,
      medianMs: 0,
      p95Ms: 0,
      p99Ms: 0,
      minMs: 0,
      maxMs: 0,
    });
  });

  it("computes median/min/max on an odd-sized sample", () => {
    const stats = computeStats(samples([50, 10, 30, 20, 40]));
    expect(stats.count).toBe(5);
    expect(stats.minMs).toBe(10);
    expect(stats.maxMs).toBe(50);
    expect(stats.medianMs).toBe(30);
  });

  it("computes p95/p99 on a 100-sample uniform distribution", () => {
    const durations = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    const stats = computeStats(samples(durations));
    expect(stats.p95Ms).toBe(95);
    expect(stats.p99Ms).toBe(99);
  });

  it("computes error rate from ok=false samples", () => {
    const stats = computeStats(samples([10, 20, 30, 40], [1, 3]));
    expect(stats.errorCount).toBe(2);
    expect(stats.errorRate).toBe(0.5);
  });

  it("is not skewed by input order", () => {
    const ordered = computeStats(samples([10, 20, 30, 40, 50]));
    const shuffled = computeStats(samples([40, 10, 50, 30, 20]));
    expect(shuffled).toEqual(ordered);
  });
});
