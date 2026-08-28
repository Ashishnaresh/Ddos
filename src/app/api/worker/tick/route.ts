import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { recoverOrphans, runOneTick } from "@/lib/workerCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel clamps this to the plan maximum (Hobby 60s, Pro 300s). The tick's own
// time budget is WORKER_TICK_BUDGET_SECONDS and must be set below this.
export const maxDuration = 300;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Serverless load-test worker tick.
 *
 * Invoked by Vercel Cron (see vercel.json) once per minute. Each invocation
 * recovers orphaned tests, then claims and runs ONE authorized test within a
 * bounded wall-clock budget. Authorized by the Vercel Cron `Authorization`
 * header (CRON_SECRET) or an explicit `x-worker-secret` (WORKER_TICK_SECRET).
 *
 * Fail-closed behavior (DB down, emergency stop, capacity) lives in workerCore.
 */
async function handle(req: NextRequest): Promise<NextResponse> {
  const authz = req.headers.get("authorization") ?? "";
  const manual = req.headers.get("x-worker-secret") ?? "";

  const cronOk =
    env.CRON_SECRET.length > 0 && safeEqual(authz, `Bearer ${env.CRON_SECRET}`);
  const manualOk =
    env.WORKER_TICK_SECRET.length > 0 && safeEqual(manual, env.WORKER_TICK_SECRET);

  if (!cronOk && !manualOk) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid worker credentials." } },
      { status: 401 },
    );
  }

  const workerId = `vercel-cron-${env.WORKER_ID}`;
  const budgetMs = env.WORKER_TICK_BUDGET_SECONDS * 1000;
  const deadline = Date.now() + budgetMs;

  try {
    const recovered = await recoverOrphans(workerId);
    const testId = await runOneTick({
      workerId,
      hardDeadlineMs: deadline,
      externalShouldStop: () => Date.now() > deadline,
    });
    return NextResponse.json({
      ok: true,
      recovered,
      ranTest: testId ?? null,
      budgetSeconds: env.WORKER_TICK_BUDGET_SECONDS,
    });
  } catch (err) {
    logger.error("worker tick route failed", { err: (err as Error).message });
    return NextResponse.json(
      { error: { code: "TICK_FAILED", message: "Worker tick failed." } },
      { status: 500 },
    );
  }
}

export const GET = handle; // Vercel Cron issues GET
export const POST = handle; // manual trigger
