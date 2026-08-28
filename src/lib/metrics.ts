/** Metric aggregation helpers shared by the load engine and the worker. */

export interface MetricBucket {
  bucketStart: Date;
  intervalMs: number;
  requests: number;
  successes: number;
  failures: number;
  timeouts: number;
  errors: number;
  requestsPerSecond: number;
  concurrencyPeak: number;
  latencyAvgMs: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  latencyMaxMs: number;
  statusCounts: Record<string, number>;
}

export interface RollingSample {
  latencyMs: number;
  ok: boolean;
  timedOut: boolean;
  errored: boolean;
  status: number | null;
}

export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = rank - lo;
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac;
}

export function summarize(
  samples: RollingSample[],
  bucketStart: Date,
  intervalMs: number,
  concurrencyPeak: number,
): MetricBucket {
  const latencies = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
  const statusCounts: Record<string, number> = {};
  let successes = 0;
  let failures = 0;
  let timeouts = 0;
  let errors = 0;
  for (const s of samples) {
    if (s.status != null) {
      const key = String(s.status);
      statusCounts[key] = (statusCounts[key] ?? 0) + 1;
    }
    if (s.timedOut) timeouts++;
    if (s.errored) errors++;
    if (s.ok) successes++;
    else failures++;
  }
  const sum = latencies.reduce((a, b) => a + b, 0);
  return {
    bucketStart,
    intervalMs,
    requests: samples.length,
    successes,
    failures,
    timeouts,
    errors,
    requestsPerSecond: intervalMs > 0 ? (samples.length * 1000) / intervalMs : 0,
    concurrencyPeak,
    latencyAvgMs: latencies.length ? sum / latencies.length : 0,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    latencyP99Ms: percentile(latencies, 99),
    latencyMaxMs: latencies.length ? latencies[latencies.length - 1]! : 0,
    statusCounts,
  };
}

export interface TestSummary {
  totalRequests: number;
  successes: number;
  failures: number;
  timeouts: number;
  errors: number;
  statusCounts: Record<string, number>;
  avgRps: number;
  latencyAvgMs: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  latencyMaxMs: number;
  durationMs: number;
}

export function mergeSummary(
  buckets: MetricBucket[],
  allLatencies: number[],
  durationMs: number,
): TestSummary {
  const sorted = [...allLatencies].sort((a, b) => a - b);
  const statusCounts: Record<string, number> = {};
  let totalRequests = 0;
  let successes = 0;
  let failures = 0;
  let timeouts = 0;
  let errors = 0;
  for (const b of buckets) {
    totalRequests += b.requests;
    successes += b.successes;
    failures += b.failures;
    timeouts += b.timeouts;
    errors += b.errors;
    for (const [k, v] of Object.entries(b.statusCounts)) {
      statusCounts[k] = (statusCounts[k] ?? 0) + v;
    }
  }
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    totalRequests,
    successes,
    failures,
    timeouts,
    errors,
    statusCounts,
    avgRps: durationMs > 0 ? (totalRequests * 1000) / durationMs : 0,
    latencyAvgMs: sorted.length ? sum / sorted.length : 0,
    latencyP50Ms: percentile(sorted, 50),
    latencyP95Ms: percentile(sorted, 95),
    latencyP99Ms: percentile(sorted, 99),
    latencyMaxMs: sorted.length ? sorted[sorted.length - 1]! : 0,
    durationMs,
  };
}
