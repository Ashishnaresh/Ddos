import { ApiError, defineHandler, json } from "@/lib/apiHandler";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ACTIVE_STATUSES } from "@/lib/lifecycle";
import { emergencyStopSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export const GET = defineHandler(
  { auth: "required", permission: "tests:view" },
  async () => {
    const state = await prisma.emergencyStopState.findUnique({
      where: { id: "global" },
    });
    const activeTests = await prisma.test.count({
      where: { status: { in: ACTIVE_STATUSES } },
    });
    return json({ state: state ?? { active: false }, activeTests });
  },
);

export const POST = defineHandler(
  {
    auth: "required",
    permission: "emergency:stop",
    roles: ["ADMIN"],
    bodySchema: emergencyStopSchema,
  },
  async ({ body, user, ip }) => {
    if (body.clear) {
      const state = await prisma.emergencyStopState.upsert({
        where: { id: "global" },
        create: { id: "global", active: false, clearedAt: new Date() },
        update: { active: false, clearedAt: new Date(), reason: null },
      });
      await writeAudit({
        eventType: "EMERGENCY_STOP",
        userId: user.id,
        observedIp: ip,
        message: "Global emergency stop CLEARED",
        result: "cleared",
      });
      return json({ state });
    }

    if (body.scope === "one") {
      if (!body.testId) throw new ApiError(400, "MISSING_TEST", "testId required.");
      const test = await prisma.test.findUnique({ where: { id: body.testId } });
      if (!test) throw new ApiError(404, "NOT_FOUND", "Test not found.");
      await prisma.test.updateMany({
        where: { id: body.testId, status: { in: ["RUNNING", "STARTING"] } },
        data: { stopRequested: true, stopReason: body.reason, stoppedById: user.id, status: "STOPPING" },
      });
      await prisma.test.updateMany({
        where: { id: body.testId, status: { in: ["CREATED", "AUTHORIZING", "AUTHORIZED"] } },
        data: {
          status: "ABORTED",
          stopRequested: true,
          stopReason: body.reason,
          stoppedById: user.id,
          endedAt: new Date(),
        },
      });
      await writeAudit({
        eventType: "EMERGENCY_STOP",
        userId: user.id,
        observedIp: ip,
        testId: body.testId,
        targetId: test.targetId,
        message: `Emergency stop of single test: ${body.reason}`,
        result: "single_stop",
      });
      return json({ ok: true });
    }

    // scope === "all": raise the global kill switch + signal every active test.
    const state = await prisma.emergencyStopState.upsert({
      where: { id: "global" },
      create: {
        id: "global",
        active: true,
        reason: body.reason,
        activatedById: user.id,
        activatedAt: new Date(),
      },
      update: {
        active: true,
        reason: body.reason,
        activatedById: user.id,
        activatedAt: new Date(),
        clearedAt: null,
      },
    });

    const running = await prisma.test.updateMany({
      where: { status: { in: ["RUNNING", "STARTING"] } },
      data: { stopRequested: true, stopReason: `EMERGENCY STOP: ${body.reason}`, stoppedById: user.id, status: "STOPPING" },
    });
    const pending = await prisma.test.updateMany({
      where: { status: { in: ["CREATED", "AUTHORIZING", "AUTHORIZED"] } },
      data: {
        status: "ABORTED",
        stopRequested: true,
        stopReason: `EMERGENCY STOP: ${body.reason}`,
        stoppedById: user.id,
        endedAt: new Date(),
      },
    });

    await writeAudit({
      eventType: "EMERGENCY_STOP",
      userId: user.id,
      observedIp: ip,
      message: `GLOBAL emergency stop activated: ${body.reason}`,
      result: "global_stop",
      metadata: { runningSignalled: running.count, pendingAborted: pending.count },
    });

    return json({ state, runningSignalled: running.count, pendingAborted: pending.count });
  },
);
