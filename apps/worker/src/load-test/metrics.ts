export interface Sample {
  durationMs: number;
  ok: boolean;
  error?: string;
}

export interface ScenarioStats {
  count: number;
  errorCount: number;
  errorRate: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
}

function percentile(sortedDurations: number[], p: number): number {
  if (sortedDurations.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedDurations.length) - 1;
  const index = Math.min(Math.max(rank, 0), sortedDurations.length - 1);
  return sortedDurations[index];
}

export function computeStats(samples: Sample[]): ScenarioStats {
  const durations = samples.map((s) => s.durationMs).sort((a, b) => a - b);
  const errorCount = samples.filter((s) => !s.ok).length;

  return {
    count: samples.length,
    errorCount,
    errorRate: samples.length === 0 ? 0 : errorCount / samples.length,
    medianMs: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    minMs: durations.length ? durations[0] : 0,
    maxMs: durations.length ? durations[durations.length - 1] : 0,
  };
}
