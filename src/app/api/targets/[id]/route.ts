import type { AuditEventType, AuthorizationStatus } from "@prisma/client";
import { ApiError, defineHandler, json } from "@/lib/apiHandler";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { updateTargetSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export const GET = defineHandler(
  { auth: "required", permission: "targets:view" },
  async ({ params }) => {
    const target = await prisma.authorizedTarget.findUnique({
      where: { id: params.id },
    });
    if (!target) throw new ApiError(404, "NOT_FOUND", "Target not found.");
    return json({ target });
  },
);

const STATUS_EVENT: Record<AuthorizationStatus, AuditEventType> = {
  PENDING: "TARGET_UPDATED",
  APPROVED: "TARGET_APPROVED",
  SUSPENDED: "TARGET_SUSPENDED",
  REVOKED: "TARGET_REVOKED",
};

export const PATCH = defineHandler(
  { auth: "required", permission: "targets:manage", bodySchema: updateTargetSchema },
  async ({ body, params, user, ip }) => {
    const existing = await prisma.authorizedTarget.findUnique({
      where: { id: params.id },
    });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Target not found.");

    const statusChange =
      body.authorizationStatus && body.authorizationStatus !== existing.authorizationStatus
        ? body.authorizationStatus
        : null;

    const target = await prisma.authorizedTarget.update({
      where: { id: params.id },
      data: {
        name: body.name,
        hostname: body.hostname,
        protocol: body.protocol,
        port: body.port,
        owner: body.owner,
        authorizationReference: body.authorizationReference,
        notes: body.notes,
        maxRequestsPerSecond: body.maxRequestsPerSecond,
        maxConcurrency: body.maxConcurrency,
        maxDurationSeconds: body.maxDurationSeconds,
        authorizationStatus: body.authorizationStatus,
      },
    });

    await writeAudit({
      eventType: statusChange ? STATUS_EVENT[statusChange] : "TARGET_UPDATED",
      userId: user.id,
      observedIp: ip,
      targetId: target.id,
      message: statusChange
        ? `Target authorization ${existing.authorizationStatus} -> ${statusChange}`
        : `Target ${target.name} updated`,
      metadata: { before: redact(existing), after: redact(target) },
    });

    // If a running/pending target is no longer APPROVED, request stop of its tests.
    if (statusChange && statusChange !== "APPROVED") {
      await prisma.test.updateMany({
        where: {
          targetId: target.id,
          status: { in: ["AUTHORIZING", "AUTHORIZED", "STARTING", "RUNNING"] },
        },
        data: {
          stopRequested: true,
          stopReason: `Target authorization changed to ${statusChange}`,
        },
      });
    }

    return json({ target });
  },
);

function redact(t: Record<string, unknown>) {
  const { createdById, ...rest } = t;
  return rest;
}
