import { waitUntil } from "@vercel/functions";
import { defineHandler, json } from "@/lib/apiHandler";
import { prisma } from "@/lib/db";
import { ACTIVE_STATUSES } from "@/lib/lifecycle";
import { rateLimit } from "@/lib/rateLimit";
import { kickWorker } from "@/lib/kickWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Authenticated, rate-limited "poke the worker" endpoint.
 *
 * On serverless deployments (Vercel Hobby) the primary trigger is a `waitUntil`
 * kick when a test is authorized, plus a daily cron. This endpoint is the
 * safety net the dashboard calls while any test is non-terminal: if a kick was
 * missed, or a tick function was killed mid-run, calling this re-runs
 * orphan-recovery + claims the next queued test. It never runs a test itself
 * and is a no-op when nothing is pending.
 */
export const POST = defineHandler(
  { auth: "required", permission: "tests:view" },
  async ({ user }) => {
    const rl = rateLimit(`nudge:${user.id}`, 6, 30 * 1000);
    if (!rl.ok) return json({ ok: true, throttled: true });

    const pending = await prisma.test.count({
      where: { status: { in: ACTIVE_STATUSES } },
    });
    if (pending > 0) {
      waitUntil(kickWorker(`nudge:${user.id}`));
    }
    return json({ ok: true, pending });
  },
);
