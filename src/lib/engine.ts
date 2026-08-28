import { setTimeout as delay } from "node:timers/promises";
import {
  mergeSummary,
  summarize,
  type MetricBucket,
  type RollingSample,
  type TestSummary,
} from "./metrics";

/**
 * Controlled application-layer HTTP load generator.
 *
 * Scope, on purpose:
 *  - Fixed target request rate (token-bucket paced), hard concurrency ceiling,
 *    fixed wall-clock duration, per-request timeout, cooperative cancellation.
 *  - Nothing else. No IP spoofing, no raw sockets, no reflection/amplification,
 *    no protocol below HTTP, no header/identity manipulation to evade
 *    CDN/WAF/rate-limit controls. It sends ordinary fetch() requests and
 *    identifies itself with a static User-Agent.
 */

export interface EngineConfig {
  url: string; // fully-resolved absolute URL (protocol + host + port + path)
  method: string;
  headers: Record<string, string>;
  body?: string; // already size-capped by safety.ts
  requestsPerSecond: number; // effective, already clamped
  concurrency: number; // effective, already clamped
  durationSeconds: number; // effective, already clamped
  requestTimeoutMs: number;
  flushIntervalMs: number;
}

export interface EngineCallbacks {
  onBucket?: (bucket: MetricBucket) => void | Promise<void>;
  /** Return true to request a graceful stop before duration elapses. */
  shouldStop?: () => boolean | Promise<boolean>;
}

export interface EngineResult {
  summary: TestSummary;
  stopped: boolean; // true if shouldStop() ended the run early
  buckets: MetricBucket[];
}

const USER_AGENT =
  "AuthorizedLoadTester/1.0 (+authorized performance testing; contact operator)";

export async function runLoadTest(
  config: EngineConfig,
  callbacks: EngineCallbacks = {},
  externalSignal?: AbortSignal,
): Promise<EngineResult> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  const startedAt = Date.now();
  const endBy = startedAt + config.durationSeconds * 1000;

  let inFlight = 0;
  let peakInWindow = 0;
  let windowSamples: RollingSample[] = [];
  let windowStart = new Date();
  const allLatencies: number[] = [];
  const buckets: MetricBucket[] = [];
  let stoppedEarly = false;

  const flush = async () => {
    const now = new Date();
    const intervalMs = now.getTime() - windowStart.getTime();
    const bucket = summarize(windowSamples, windowStart, intervalMs, peakInWindow);
    buckets.push(bucket);
    windowSamples = [];
    peakInWindow = inFlight;
    windowStart = now;
    if (callbacks.onBucket) await callbacks.onBucket(bucket);
  };

  const flushTimer = setInterval(() => {
    void flush();
  }, config.flushIntervalMs);

  const fireOne = async () => {
    inFlight++;
    peakInWindow = Math.max(peakInWindow, inFlight);
    const started = performance.now();
    let status: number | null = null;
    let timedOut = false;
    let errored = false;
    const reqController = new AbortController();
    const abortRelay = () => reqController.abort();
    controller.signal.addEventListener("abort", abortRelay, { once: true });
    const to = setTimeout(() => {
      timedOut = true;
      reqController.abort();
    }, config.requestTimeoutMs);
    try {
      const res = await fetch(config.url, {
        method: config.method,
        headers: { ...config.headers, "user-agent": USER_AGENT },
        body:
          config.body && !["GET", "HEAD"].includes(config.method.toUpperCase())
            ? config.body
            : undefined,
        signal: reqController.signal,
        redirect: "manual",
      });
      status = res.status;
      // Drain the body so sockets are released promptly.
      await res.arrayBuffer().catch(() => undefined);
    } catch {
      if (!timedOut) errored = true;
    } finally {
      clearTimeout(to);
      controller.signal.removeEventListener("abort", abortRelay);
      inFlight--;
    }
    const latencyMs = performance.now() - started;
    const ok = status != null && status >= 200 && status < 400;
    const sample: RollingSample = { latencyMs, ok, timedOut, errored, status };
    windowSamples.push(sample);
    allLatencies.push(latencyMs);
  };

  // Token-bucket pacing: release `requestsPerSecond` permits per second, spread
  // across small sub-intervals so load is smooth rather than bursty.
  const subIntervalMs = 50;
  const permitsPerSub = Math.max(
    1,
    (config.requestsPerSecond * subIntervalMs) / 1000,
  );
  let permitDebt = 0;
  const pending: Promise<void>[] = [];

  try {
    while (Date.now() < endBy && !controller.signal.aborted) {
      if (callbacks.shouldStop && (await callbacks.shouldStop())) {
        stoppedEarly = true;
        break;
      }
      permitDebt += permitsPerSub;
      while (permitDebt >= 1) {
        if (inFlight >= config.concurrency) break; // concurrency ceiling wins
        permitDebt -= 1;
        const p = fireOne();
        pending.push(p);
        void p.finally(() => {
          const idx = pending.indexOf(p);
          if (idx >= 0) pending.splice(idx, 1);
        });
      }
      await delay(subIntervalMs);
    }
  } finally {
    clearInterval(flushTimer);
  }

  // Distinguish a real early stop (shouldStop / external abort) from the
  // internal abort we always fire during cleanup below.
  const endedEarly = stoppedEarly || (externalSignal?.aborted ?? false);

  // Graceful drain: give in-flight requests up to one timeout window to finish,
  // then abort whatever remains.
  const drainDeadline = Date.now() + config.requestTimeoutMs;
  while (pending.length > 0 && Date.now() < drainDeadline) {
    await Promise.race([Promise.allSettled(pending), delay(100)]);
  }
  controller.abort();
  await Promise.allSettled(pending);
  if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);

  await flush();

  const durationMs = Date.now() - startedAt;
  const summary = mergeSummary(buckets, allLatencies, durationMs);

  return {
    summary,
    stopped: endedEarly,
    buckets,
  };
}
