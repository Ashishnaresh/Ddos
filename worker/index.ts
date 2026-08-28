/**
 * Load-Test Worker - the isolated load-generation component.
 *
 * This process is intentionally separate from the web app. It never accepts
 * inbound HTTP, never trusts client input, and only ever acts on Test rows that
 * the web tier already moved to status=AUTHORIZED after a full server-side
 * preflight (see src/lib/safety.ts). Its only job is:
 *
 *   claim AUTHORIZED test -> re-verify (fail-closed) -> run controlled HTTP load
 *   -> stream metrics -> honor stop/abort/emergency-stop -> finalize + audit.
 */
import { prisma, isDatabaseHealthy } from "../src/lib/db";
import { env } from "../src/lib/env";
import { logger } from "../src/lib/logger";
import { runLoadTest } from "../src/lib/engine";
import { writeAudit, tryWriteAudit } from "../src/lib/audit";
import { mergeSummary, type MetricBucket } from "../src/lib/metrics";
import { loadAndValidateTarget } from "../src/lib/safety";

const WORKER_ID = env.WORKER_ID;
const POLL_MS = env.WORKER_POLL_INTERVAL_MS;

interface RunningTest {
  abort: AbortController;
  buckets: MetricBucket[];
  allLatencies: number[];
  startedAt: number;
}

const running = new Map<string, RunningTest>();
let shuttingDown = false;

async function main() {
  logger.info("worker starting", { workerId: WORKER_ID });
  await recoverOrphans();

  while (!shuttingDown) {
    try {
      await tickOnce();
    } catch (err) {
      logger.error("worker tick failed", { err: (err as Error).message });
    }
    await sleep(POLL_MS);
  }
}

/** Tests this worker owned before a crash cannot be trusted to still be running. */
async function recoverOrphans() {
  const orphans = await prisma.test.findMany({
    where: {
      workerId: WORKER_ID,
      status: { in: ["STARTING", "RUNNING", "STOPPING"] },
    },
  });
  for (const t of orphans) {
    await prisma.test.update({
      where: { id: t.id },
      data: {
        status: "ABORTED",
        stopReason: "Worker restarted; test could not be resumed",
        endedAt: new Date(),
      },
    });
    await tryWriteAudit({
      eventType: "TEST_FAILED",
      testId: t.id,
      targetId: t.targetId,
      message: "Test aborted during worker recovery",
      result: "aborted",
    });
    logger.warn("recovered orphan test", { testId: t.id });
  }
}

async function tickOnce() {
  if (shuttingDown) return;

  // Fail-closed: if the DB/telemetry is unhealthy, do not claim new work.
  if (!(await isDatabaseHealthy())) {
    logger.warn("database unhealthy; not claiming tests");
    return;
  }

  const emergency = await prisma.emergencyStopState.findUnique({
    where: { id: "global" },
  });
  if (emergency?.active) return;

  if (running.size >= env.MAX_CONCURRENT_TESTS) return;

  const candidate = await prisma.test.findFirst({
    where: { status: "AUTHORIZED", workerId: null, stopRequested: false },
    orderBy: { authorizedAt: "asc" },
  });
  if (!candidate) return;

  // Atomic claim.
  const claim = await prisma.test.updateMany({
    where: { id: candidate.id, status: "AUTHORIZED", workerId: null },
    data: { workerId: WORKER_ID, status: "STARTING" },
  });
  if (claim.count !== 1) return; // lost the race

  void executeTest(candidate.id).catch((err) => {
    logger.error("executeTest crashed", {
      testId: candidate.id,
      err: (err as Error).message,
    });
  });
}

async function executeTest(testId: string) {
  const test = await prisma.test.findUnique({ where: { id: testId } });
  if (!test) return;

  // Re-verify at execution time (fail-closed). Authorization can have been
  // revoked between web-tier preflight and now.
  try {
    const target = await loadAndValidateTarget(test.targetId);
    if (
      target.hostname !== test.targetHostname ||
      target.port !== test.targetPort
    ) {
      throw new Error("Target definition changed since authorization");
    }
  } catch (err) {
    await finalize(testId, "REJECTED", `Re-check failed: ${(err as Error).message}`);
    await tryWriteAudit({
      eventType: "TEST_REJECTED",
      testId,
      targetId: test.targetId,
      message: `Worker re-check failed: ${(err as Error).message}`,
      result: "rejected",
    });
    return;
  }

  if (test.stopRequested) {
    await finalize(testId, "ABORTED", test.stopReason ?? "Stop requested before start");
    return;
  }

  const abort = new AbortController();
  const state: RunningTest = {
    abort,
    buckets: [],
    allLatencies: [],
    startedAt: Date.now(),
  };
  running.set(testId, state);

  // STARTING -> RUNNING
  const started = await prisma.test.updateMany({
    where: { id: testId, status: "STARTING" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  if (started.count !== 1) {
    running.delete(testId);
    return;
  }

  await writeAudit({
    eventType: "TEST_STARTED",
    userId: test.requestedById,
    testId,
    targetId: test.targetId,
    sessionId: test.sessionId,
    observedIp: test.observedIp,
    message: `Load test started by ${WORKER_ID}`,
    result: "running",
    metadata: {
      rps: test.requestsPerSecond,
      concurrency: test.concurrency,
      durationSeconds: test.durationSeconds,
    },
  }).catch(() => undefined);

  const protocol = (test.targetPort === 443 ? "https" : "http");
  // Rebuild absolute URL from the stored, already-validated components.
  const targetRow = await prisma.authorizedTarget.findUnique({
    where: { id: test.targetId },
  });
  const scheme = (targetRow?.protocol ?? protocol).toString().toLowerCase();
  const url = `${scheme}://${test.targetHostname}:${test.targetPort}${test.path}`;

  let consecutiveMetricFailures = 0;

  // Outer hard duration guard (belt and suspenders on top of engine timing).
  const hardTimer = setTimeout(
    () => {
      logger.warn("hard duration guard fired", { testId });
      abort.abort();
    },
    (test.durationSeconds + 15) * 1000,
  );

  let stopReason: string | null = null;

  try {
    const result = await runLoadTest(
      {
        url,
        method: test.method,
        headers: (test.headersJson as Record<string, string>) ?? {},
        body: test.bodySize > 0 ? ((test.requestedConfigJson as { body?: string }).body ?? undefined) : undefined,
        requestsPerSecond: test.requestsPerSecond,
        concurrency: test.concurrency,
        durationSeconds: test.durationSeconds,
        requestTimeoutMs: test.requestTimeoutMs,
        flushIntervalMs: env.METRICS_FLUSH_INTERVAL_MS,
      },
      {
        onBucket: async (bucket) => {
          state.buckets.push(bucket);
          try {
            await prisma.testMetric.create({
              data: {
                testId,
                bucketStart: bucket.bucketStart,
                intervalMs: bucket.intervalMs,
                requests: bucket.requests,
                successes: bucket.successes,
                failures: bucket.failures,
                timeouts: bucket.timeouts,
                errors: bucket.errors,
                requestsPerSecond: bucket.requestsPerSecond,
                concurrencyPeak: bucket.concurrencyPeak,
                latencyAvgMs: bucket.latencyAvgMs,
                latencyP50Ms: bucket.latencyP50Ms,
                latencyP95Ms: bucket.latencyP95Ms,
                latencyP99Ms: bucket.latencyP99Ms,
                latencyMaxMs: bucket.latencyMaxMs,
                statusCountsJson: bucket.statusCounts,
              },
            });
            consecutiveMetricFailures = 0;
          } catch {
            consecutiveMetricFailures++;
            if (consecutiveMetricFailures >= 5) {
              stopReason = "Telemetry persistence failing - aborting (fail-safe)";
              abort.abort();
            }
          }
        },
        shouldStop: async () => {
          if (shuttingDown) {
            stopReason = "Worker shutting down";
            return true;
          }
          const row = await prisma.test
            .findUnique({
              where: { id: testId },
              select: { stopRequested: true, status: true, stopReason: true },
            })
            .catch(() => null);
          if (!row) return false;
          if (row.stopRequested || row.status === "STOPPING") {
            stopReason = row.stopReason ?? "Stop requested";
            return true;
          }
          return false;
        },
      },
      abort.signal,
    );

    clearTimeout(hardTimer);

    const durationMs = Date.now() - state.startedAt;
    const summary =
      result.summary ?? mergeSummary(state.buckets, state.allLatencies, durationMs);

    const finalStatus = result.stopped || stopReason ? "ABORTED" : "COMPLETED";
    await finalizeWithSummary(testId, finalStatus, stopReason, summary);

    await writeAudit({
      eventType: finalStatus === "COMPLETED" ? "TEST_COMPLETED" : "TEST_STOPPED",
      userId: test.requestedById,
      testId,
      targetId: test.targetId,
      sessionId: test.sessionId,
      observedIp: test.observedIp,
      message:
        finalStatus === "COMPLETED"
          ? `Test completed: ${summary.totalRequests} requests`
          : `Test stopped: ${stopReason ?? "aborted"}`,
      result: finalStatus.toLowerCase(),
      metadata: { summary },
    }).catch(() => undefined);
  } catch (err) {
    clearTimeout(hardTimer);
    logger.error("test execution error", { testId, err: (err as Error).message });
    await finalize(testId, "FAILED", (err as Error).message);
    await tryWriteAudit({
      eventType: "TEST_FAILED",
      testId,
      targetId: test.targetId,
      message: `Execution error: ${(err as Error).message}`,
      result: "failed",
    });
  } finally {
    running.delete(testId);
  }
}

async function finalize(testId: string, status: "COMPLETED" | "FAILED" | "ABORTED" | "REJECTED", reason: string | null) {
  await prisma.test
    .updateMany({
      where: { id: testId, status: { in: ["STARTING", "RUNNING", "STOPPING", "AUTHORIZED"] } },
      data: { status, stopReason: reason ?? undefined, endedAt: new Date() },
    })
    .catch((err) => logger.error("finalize failed", { testId, err: (err as Error).message }));
}

async function finalizeWithSummary(
  testId: string,
  status: "COMPLETED" | "ABORTED",
  reason: string | null,
  summary: unknown,
) {
  await prisma.test
    .updateMany({
      where: { id: testId, status: { in: ["RUNNING", "STOPPING"] } },
      data: {
        status,
        stopReason: reason ?? undefined,
        endedAt: new Date(),
        summaryJson: JSON.parse(JSON.stringify(summary ?? {})),
      },
    })
    .catch((err) => logger.error("finalize summary failed", { testId, err: (err as Error).message }));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("worker shutting down", { signal, active: running.size });
  for (const [, s] of running) s.abort.abort();

  const deadline = Date.now() + 15000;
  while (running.size > 0 && Date.now() < deadline) {
    await sleep(200);
  }
  // Anything still not finalized gets marked aborted.
  for (const testId of running.keys()) {
    await finalize(testId, "ABORTED", `Worker ${signal} shutdown`);
  }
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((err) => {
  logger.error("worker fatal", { err: (err as Error).message });
  process.exit(1);
});
