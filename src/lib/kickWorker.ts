import { env } from "./env";
import { logger } from "./logger";

/**
 * Fire-and-forget nudge to the serverless worker tick route.
 *
 * On platforms without a persistent worker (e.g. Vercel Hobby, where Cron only
 * fires daily) this is how an authorized test gets picked up promptly: the
 * web request that authorizes a test schedules a `kickWorker()` via
 * `unstable_after`, which triggers one `/api/worker/tick` invocation. The tick
 * route re-kicks itself while it keeps finding work, so a queue drains without
 * any polling.
 *
 * Safe no-op when WORKER_TICK_SECRET is unset (i.e. the long-lived worker model).
 */
export async function kickWorker(reason: string): Promise<void> {
  if (!env.WORKER_TICK_SECRET) return;
  const url = `${env.APP_URL.replace(/\/$/, "")}/api/worker/tick`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-worker-secret": env.WORKER_TICK_SECRET },
      // Do not wait for the load test to finish - just trigger the invocation.
      signal: AbortSignal.timeout(5000),
    });
    logger.info("kickWorker sent", { reason, status: res.status });
  } catch (err) {
    // A timeout here is expected and fine: the tick invocation keeps running
    // server-side after we stop waiting for the response.
    logger.debug("kickWorker fetch ended", {
      reason,
      err: (err as Error).message,
    });
  }
}
