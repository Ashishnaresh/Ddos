import { ApiError, defineHandler, json } from "@/lib/apiHandler";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { revokeAllUserSessions } from "@/lib/session";
import { updateUserSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export const PATCH = defineHandler(
  {
    auth: "required",
    permission: "users:manage",
    roles: ["ADMIN"],
    bodySchema: updateUserSchema,
  },
  async ({ body, params, user, ip }) => {
    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target) throw new ApiError(404, "NOT_FOUND", "User not found.");

    if (target.id === user.id && (body.role || body.isActive === false)) {
      throw new ApiError(
        400,
        "SELF_MODIFY",
        "You cannot change your own role or disable yourself.",
      );
    }

    // Guard against removing the last active admin.
    if (
      target.role === "ADMIN" &&
      (body.role === "OPERATOR" || body.role === "VIEWER" || body.isActive === false)
    ) {
      const admins = await prisma.user.count({
        where: { role: "ADMIN", isActive: true },
      });
      if (admins <= 1) {
        throw new ApiError(400, "LAST_ADMIN", "At least one active admin is required.");
      }
    }

    const updated = await prisma.user.update({
      where: { id: params.id },
      data: {
        role: body.role,
        isActive: body.isActive,
        ...(body.isActive === true ? { failedLogins: 0, lockedUntil: null } : {}),
      },
      select: { id: true, email: true, role: true, isActive: true, displayName: true },
    });

    if (body.isActive === false || body.role) {
      await revokeAllUserSessions(params.id);
    }

    await writeAudit({
      eventType: body.role ? "USER_ROLE_CHANGED" : "USER_CREATED",
      userId: user.id,
      observedIp: ip,
      message: `Admin updated user ${target.email}`,
      metadata: {
        targetUserId: target.id,
        before: { role: target.role, isActive: target.isActive },
        after: { role: updated.role, isActive: updated.isActive },
      },
    });

    return json({ user: updated });
  },
);
