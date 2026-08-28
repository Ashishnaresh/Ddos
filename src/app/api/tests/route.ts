import { waitUntil } from "@vercel/functions";
import { defineHandler, json } from "@/lib/apiHandler";
import { prisma } from "@/lib/db";
import { writeAudit, tryWriteAudit } from "@/lib/audit";
import { createTestSchema } from "@/lib/schemas";
import { runPreflight, SafetyError } from "@/lib/safety";
import { transitionTest } from "@/lib/testRepo";
import { kickWorker } from "@/lib/kickWorker";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export const GET = defineHandler(
  { auth: "required", permission: "tests:view" },
  async ({ req }) => {
    const url = new URL(req.url);
    const take = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const status = url.searchParams.get("status") ?? undefined;
    const tests = await prisma.test.findMany({
      where: status ? { status: status as never } : undefined,
      orderBy: { requestedAt: "desc" },
      take,
      include: {
        target: { select: { name: true, hostname: true, port: true } },
        requestedBy: { select: { displayName: true, email: true } },
      },
    });
    return json({ tests });
  },
);

export const POST = defineHandler(
  { auth: "required", permission: "tests:start", bodySchema: createTestSchema },
  async ({ body, user, ip, session }) => {
    // 1. audit the request itself, before any work.
    await writeAudit({
      eventType: "TEST_REQUESTED",
      userId: user.id,
      observedIp: ip,
      targetId: body.targetId,
      sessionId: session.id,
      message: `Test requested against target ${body.targetId}`,
      metadata: { requested: body },
    });

    // 2. create the CREATED row so even a rejection is in test history.
    const test = await prisma.test.create({
      data: {
        status: "CREATED",
        targetId: body.targetId,
        requestedById: user.id,
        method: body.method,
        path: body.path,
        requestsPerSecond: body.requestsPerSecond,
        concurrency: body.concurrency,
        durationSeconds: body.durationSeconds,
        requestTimeoutMs: body.requestTimeoutMs,
        headersJson: body.headers ?? undefined,
        bodySize: body.body ? Buffer.byteLength(body.body, "utf8") : 0,
        requestedConfigJson: JSON.parse(JSON.stringify(body)),
        sessionId: session.id,
        observedIp: ip,
        targetHostname: "",
        targetPort: 0,
      },
    });

    try {
      await transitionTest(test.id, "CREATED", "AUTHORIZING");

      // 3. full server-side preflight (fail-closed, RBAC, allowlist, clamp).
      const { target, effective } = await runPreflight({
        user,
        targetId: body.targetId,
        requested: body,
      });

      if (effective.clamped.length > 0) {
        await tryWriteAudit({
          eventType: "SAFETY_LIMIT_TRIGGERED",
          userId: user.id,
          observedIp: ip,
          testId: test.id,
          targetId: target.id,
          message: `Config values clamped to server limits: ${effective.clamped.join(", ")}`,
          metadata: { requested: body, effective },
        });
      }

      await prisma.test.update({
        where: { id: test.id },
        data: {
          method: effective.method,
          path: effective.path,
          requestsPerSecond: effective.requestsPerSecond,
          concurrency: effective.concurrency,
          durationSeconds: effective.durationSeconds,
          requestTimeoutMs: effective.requestTimeoutMs,
          headersJson: effective.headers,
          bodySize: effective.bodySize,
          targetHostname: target.hostname,
          targetPort: target.port,
        },
      });

      const authorized = await transitionTest(test.id, "AUTHORIZING", "AUTHORIZED", {
        authorizedAt: new Date(),
      });

      await writeAudit({
        eventType: "TEST_AUTHORIZED",
        userId: user.id,
        observedIp: ip,
        testId: test.id,
        targetId: target.id,
        sessionId: session.id,
        message: `Test authorized for ${target.hostname}:${target.port}${effective.path}`,
        result: "authorized",
        metadata: { effective },
      });

      // Nudge the serverless worker to pick this up now (no-op when a
      // long-lived worker is running). Continues after the response is sent.
      waitUntil(kickWorker(`test-authorized:${test.id}`));

      return json({ test: authorized }, 201);
    } catch (err) {
      const isSafety = err instanceof SafetyError;
      const reason = err instanceof Error ? err.message : "unknown error";
      await prisma.test
        .updateMany({
          where: { id: test.id, status: { in: ["CREATED", "AUTHORIZING"] } },
          data: { status: "REJECTED", stopReason: reason, endedAt: new Date() },
        })
        .catch(() => undefined);

      await tryWriteAudit({
        eventType: isSafety && (err as SafetyError).httpStatus === 503
          ? "SERVICE_UNAVAILABLE"
          : "TEST_REJECTED",
        userId: user.id,
        observedIp: ip,
        testId: test.id,
        targetId: body.targetId,
        sessionId: session.id,
        message: `Test rejected: ${reason}`,
        result: "rejected",
        failureReason: isSafety ? (err as SafetyError).code : "internal_error",
      });

      if (isSafety) throw err; // mapped to proper status by apiHandler
      logger.error("test authorization failed", { testId: test.id, reason });
      return json(
        { error: { code: "TEST_SETUP_FAILED", message: "Could not authorize test." } },
        500,
      );
    }
  },
);
