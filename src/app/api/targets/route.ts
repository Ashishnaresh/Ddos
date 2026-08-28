import { defineHandler, json } from "@/lib/apiHandler";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { createTargetSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export const GET = defineHandler(
  { auth: "required", permission: "targets:view" },
  async ({ user }) => {
    const targets = await prisma.authorizedTarget.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: { select: { displayName: true, email: true } },
        _count: { select: { tests: true } },
      },
    });
    // Operators/viewers see the list; only admins can mutate (enforced on write).
    return json({ targets, canManage: user.role === "ADMIN" });
  },
);

export const POST = defineHandler(
  { auth: "required", permission: "targets:manage", bodySchema: createTargetSchema },
  async ({ body, user, ip }) => {
    const target = await prisma.authorizedTarget.create({
      data: {
        ...body,
        authorizationStatus: "PENDING", // never trust a client-supplied status
        createdById: user.id,
      },
    });
    await writeAudit({
      eventType: "TARGET_CREATED",
      userId: user.id,
      observedIp: ip,
      targetId: target.id,
      message: `Target ${target.name} (${target.hostname}:${target.port}) created`,
      metadata: { authorizationReference: target.authorizationReference },
    });
    return json({ target }, 201);
  },
);
