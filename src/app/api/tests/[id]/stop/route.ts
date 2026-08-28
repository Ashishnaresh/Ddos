import { ApiError, defineHandler, json } from "@/lib/apiHandler";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { isTerminal } from "@/lib/lifecycle";
import { authorizeUserForStop } from "@/lib/safety";
import { stopTestSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export const POST = defineHandler(
  { auth: "required", permission: "tests:stop:own", bodySchema: stopTestSchema },
  async ({ body, params, user, ip, session }) => {
    const test = await prisma.test.findUnique({ where: { id: params.id } });
    if (!test) throw new ApiError(404, "NOT_FOUND", "Test not found.");

    // OPERATOR may stop only their own test; ADMIN may stop any.
    authorizeUserForStop(user, test);

    if (isTerminal(test.status)) {
      throw new ApiError(409, "ALREADY_ENDED", `Test already ${test.status}.`);
    }

    // Signal the worker. The worker performs the actual state transition to
    // STOPPING -> ABORTED and drains in-flight requests via AbortController.
    // If no worker has claimed it yet, abort it directly here.
    if (test.status === "RUNNING" || test.status === "STARTING" || test.workerId) {
      await prisma.test.updateMany({
        where: { id: test.id, status: { in: ["RUNNING", "STARTING"] } },
        data: {
          stopRequested: true,
          stopReason: body.reason,
          stoppedById: user.id,
          status: "STOPPING",
        },
      });
      await prisma.test.updateMany({
        where: { id: test.id, status: { in: ["AUTHORIZING", "AUTHORIZED"] } },
        data: { stopRequested: true, stopReason: body.reason, stoppedById: user.id },
      });
    } else {
      await prisma.test.updateMany({
        where: {
          id: test.id,
          status: { in: ["CREATED", "AUTHORIZING", "AUTHORIZED"] },
        },
        data: {
          status: "ABORTED",
          stopRequested: true,
          stopReason: body.reason,
          stoppedById: user.id,
          endedAt: new Date(),
        },
      });
    }

    await writeAudit({
      eventType: "TEST_STOPPED",
      userId: user.id,
      observedIp: ip,
      testId: test.id,
      targetId: test.targetId,
      sessionId: session.id,
      message: `Stop requested: ${body.reason}`,
      result: "stop_requested",
    });

    const updated = await prisma.test.findUnique({ where: { id: test.id } });
    return json({ test: updated });
  },
);
