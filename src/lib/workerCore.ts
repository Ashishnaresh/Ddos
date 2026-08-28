/**
 * Shared load-test execution core.
 *
 * Used by BOTH deployment models:
 *   - the long-lived `worker/index.ts` process (polls in a loop), and
 *   - the serverless `/api/worker/tick` route invoked by Vercel Cron.
 *
 * It only ever acts on Test rows the web tier already moved to AUTHORIZED after
 * a full server-side preflight. It re-verifies authorization at execution time
 * (fail-closed) and honors stop / emergency-stop / hard time budgets.
 */
import { prisma, isDatabaseHealthy } from "./db";
import { env } from "./env";
import { logger } from "./logger";
import { runLoadTest } from "./engine";
import { writeAudit, tryWriteAudit } from "./audit";
import { mergeSummary } from "./metrics";
import { loadAndValidateTarget } from "./safety";
import { ACTIVE_STATUSES } from "./lifecycle";

export interface ExecuteOptions {
  workerId: string;
  /** Extra cooperative stop signal (e.g. the process is shutting down). */
  externalShouldStop?: () => boolean;
  /** Absolute epoch-ms budget; the run is aborted (ABORTED) when reached. */
  hardDeadlineMs?: number;
}

/** Tests a worker owned before a crash / redeploy cannot be trusted as running. */
export async function recoverOrphans(workerId: string): Promise<number> {
  const orphans = await prisma.test.findMany({
    where: { workerId, status: { in: ["STARTING", "RUNNING", "STOPPING"] } },
  });
  for (const t of orphans) {
    await prisma.test.updateMany({
      where: { id: t.id, status: { in: ["STARTING", "RUNNING", "STOPPING"] } },
      data: {
        status: "ABORTED",
        stopReason: "Worker restart / redeploy; test could not be resumed",
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
    logger.warn("recovered orphan test", { testId: t.id, workerId });
  }
  return orphans.length;
}

export interface ClaimContext {
  activeCount: number; // active tests this caller already runs locally
}

/**
 * Atomically claim the next AUTHORIZED test. Returns its id, or null if nothing
 * to do / not permitted right now (fail-closed on DB / emergency stop /
 * capacity).
 */
export async function claimNextTest(
  workerId: string,
  ctx: ClaimContext = { activeCount: 0 },
): Promise<string | null> {
  if (!(await isDatabaseHealthy())) {
    logger.warn("database unhealthy; not claiming tests", { workerId });
    return null;
  }

  const emergency = await prisma.emergencyStopState.findUnique({
    where: { id: "global" },
  });
  if (emergency?.active) return null;

  const globalActive = await prisma.test.count({
    where: { status: { in: ACTIVE_STATUSES } },
  });
  if (
    globalActive >= env.MAX_CONCURRENT_TESTS ||
    ctx.activeCount >= env.MAX_CONCURRENT_TESTS
  ) {
    return null;
  }

  const candidate = await prisma.test.findFirst({
    where: { status: "AUTHORIZED", workerId: null, stopRequested: false },
    orderBy: { authorizedAt: "asc" },
  });
  if (!candidate) return null;

  const claim = await prisma.test.updateMany({
    where: { id: candidate.id, status: "AUTHORIZED", workerId: null },
    data: { workerId, status: "STARTING" },
  });
  return claim.count === 1 ? candidate.id : null;
}

async function finalize(
  testId: string,
  status: "COMPLETED" | "FAILED" | "ABORTED" | "REJECTED",
  reason: string | null,
) {
  await prisma.test
    .updateMany({
      where: {
        id: testId,
        status: { in: ["STARTING", "RUNNING", "STOPPING", "AUTHORIZED"] },
      },
      data: { status, stopReason: reason ?? undefined, endedAt: new Date() },
    })
    .catch((err) =>
      logger.error("finalize failed", { testId, err: (err as Error).message }),
    );
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
    .catch((err) =>
      logger.error("finalize summary failed", {
        testId,
        err: (err as Error).message,
      }),
    );
}

/** Run a test that this worker has already claimed (status STARTING). */
export async function executeClaimedTest(
  testId: string,
  opts: ExecuteOptions,
): Promise<void> {
  const test = await prisma.test.findUnique({ where: { id: testId } });
  if (!test) return;

  // Re-verify authorization at execution time (fail-closed).
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
  const startedAt = Date.now();

  const started = await prisma.test.updateMany({
    where: { id: testId, status: "STARTING" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  if (started.count !== 1) return;

  await writeAudit({
    eventType: "TEST_STARTED",
    userId: test.requestedById,
    testId,
    targetId: test.targetId,
    sessionId: test.sessionId,
    observedIp: test.observedIp,
    message: `Load test started by ${opts.workerId}`,
    result: "running",
    metadata: {
      rps: test.requestsPerSecond,
      concurrency: test.concurrency,
      durationSeconds: test.durationSeconds,
    },
  }).catch(() => undefined);

  const targetRow = await prisma.authorizedTarget.findUnique({
    where: { id: test.targetId },
  });
  const scheme = (targetRow?.protocol ?? (test.targetPort === 443 ? "HTTPS" : "HTTP"))
    .toString()
    .toLowerCase();
  const url = `${scheme}://${test.targetHostname}:${test.targetPort}${test.path}`;

  let consecutiveMetricFailures = 0;
  let stopReason: string | null = null;

  const hardTimer = setTimeout(
    () => {
      logger.warn("hard duration guard fired", { testId });
      stopReason = "Hard duration guard";
      abort.abort();
    },
    (test.durationSeconds + 15) * 1000,
  );

  const deadlineTimer = opts.hardDeadlineMs
    ? setTimeout(
        () => {
          stopReason = "Serverless time budget reached";
          abort.abort();
        },
        Math.max(1000, opts.hardDeadlineMs - Date.now()),
      )
    : null;

  try {
    const result = await runLoadTest(
      {
        url,
        method: test.method,
        headers: (test.headersJson as Record<string, string> | null) ?? {},
        body:
          test.bodySize > 0
            ? ((test.requestedConfigJson as { body?: string } | null)?.body ??
              undefined)
            : undefined,
        requestsPerSecond: test.requestsPerSecond,
        concurrency: test.concurrency,
        durationSeconds: test.durationSeconds,
        requestTimeoutMs: test.requestTimeoutMs,
        flushIntervalMs: env.METRICS_FLUSH_INTERVAL_MS,
      },
      {
        onBucket: async (bucket) => {
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
          if (opts.externalShouldStop?.()) {
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

    const durationMs = Date.now() - startedAt;
    const summary = result.summary ?? mergeSummary(result.buckets, [], durationMs);
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
    clearTimeout(hardTimer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}

/**
 * One claim-and-run cycle. Returns the claimed test id, or null if there was
 * nothing to do. Used by the serverless tick route.
 */
export async function runOneTick(opts: ExecuteOptions): Promise<string | null> {
  const testId = await claimNextTest(opts.workerId);
  if (!testId) return null;
  await executeClaimedTest(testId, opts);
  return testId;
}
