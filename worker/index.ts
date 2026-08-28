/**
 * Load-Test Worker - long-lived process deployment model.
 *
 * Polls for AUTHORIZED tests and runs them via the shared execution core
 * (src/lib/workerCore.ts). This process never accepts inbound HTTP.
 *
 * For serverless / Vercel deployments the same core is driven by the
 * Cron-invoked route at src/app/api/worker/tick/route.ts instead.
 */
import { prisma, isDatabaseHealthy } from "../src/lib/db";
import { env } from "../src/lib/env";
import { logger } from "../src/lib/logger";
import {
  claimNextTest,
  executeClaimedTest,
  recoverOrphans,
} from "../src/lib/workerCore";

const WORKER_ID = env.WORKER_ID;
const POLL_MS = env.WORKER_POLL_INTERVAL_MS;

const running = new Set<string>();
let shuttingDown = false;

async function main() {
  logger.info("worker starting", { workerId: WORKER_ID });
  await recoverOrphans(WORKER_ID);

  while (!shuttingDown) {
    try {
      const testId = await claimNextTest(WORKER_ID, { activeCount: running.size });
      if (testId) {
        running.add(testId);
        void executeClaimedTest(testId, {
          workerId: WORKER_ID,
          externalShouldStop: () => shuttingDown,
        })
          .catch((err) =>
            logger.error("executeClaimedTest crashed", {
              testId,
              err: (err as Error).message,
            }),
          )
          .finally(() => running.delete(testId));
        continue; // try to claim more immediately, up to the concurrency cap
      }
    } catch (err) {
      logger.error("worker tick failed", { err: (err as Error).message });
    }
    await sleep(POLL_MS);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("worker shutting down", { signal, active: running.size });

  const deadline = Date.now() + 20_000;
  while (running.size > 0 && Date.now() < deadline) {
    await sleep(200);
  }
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Surface unhealthy DB early but keep polling (fail-closed is handled in core).
void isDatabaseHealthy().then((ok) => {
  if (!ok) logger.warn("database not reachable at startup");
});

main().catch((err) => {
  logger.error("worker fatal", { err: (err as Error).message });
  process.exit(1);
});
