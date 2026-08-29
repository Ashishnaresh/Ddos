import { randomBytes } from "node:crypto";
import { ApiError, defineHandler, json } from "@/lib/apiHandler";
import { prisma } from "@/lib/db";
import { hashPassword, passwordPolicyError } from "@/lib/password";
import { revokeAllUserSessions } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { adminResetPasswordSchema } from "@/lib/schemas";

export const runtime = "nodejs";

/**
 * ADMIN resets another user's password and receives the new value once.
 * Use this to onboard a user or unlock one without email delivery. For your own
 * password use /settings; for a total admin lockout use `npm run reset-password`.
 */
export const POST = defineHandler(
  {
    auth: "required",
    permission: "users:manage",
    roles: ["ADMIN"],
    bodySchema: adminResetPasswordSchema,
  },
  async ({ body, params, user, ip }) => {
    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target) throw new ApiError(404, "NOT_FOUND", "User not found.");

    const password =
      body.newPassword ?? "Reset-" + randomBytes(9).toString("base64url") + "9Aa";
    const policyErr = passwordPolicyError(password);
    if (policyErr) throw new ApiError(400, "WEAK_PASSWORD", policyErr);

    await prisma.user.update({
      where: { id: target.id },
      data: {
        passwordHash: await hashPassword(password),
        failedLogins: 0,
        lockedUntil: null,
      },
    });
    await revokeAllUserSessions(target.id);
    await prisma.passwordResetToken.updateMany({
      where: { userId: target.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await writeAudit({
      eventType: "PASSWORD_RESET",
      userId: user.id,
      observedIp: ip,
      message: `Admin reset password for ${target.email}; their sessions revoked`,
      result: "success",
      metadata: { targetUserId: target.id },
    });

    return json({
      password,
      generated: !body.newPassword,
      user: { id: target.id, email: target.email },
    });
  },
);
