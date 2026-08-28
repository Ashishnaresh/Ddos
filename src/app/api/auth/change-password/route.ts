import { ApiError, defineHandler, json } from "@/lib/apiHandler";
import { prisma } from "@/lib/db";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/lib/password";
import { revokeAllUserSessions, createSession } from "@/lib/session";
import { setSessionCookies } from "@/lib/cookies";
import { rateLimit } from "@/lib/rateLimit";
import { writeAudit } from "@/lib/audit";
import { changePasswordSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export const POST = defineHandler(
  { auth: "required", bodySchema: changePasswordSchema, maxBodyBytes: 8 * 1024 },
  async ({ body, user, ip, req }) => {
    const rl = rateLimit(`chpw:${user.id}`, 5, 15 * 60 * 1000);
    if (!rl.ok) {
      throw new ApiError(429, "RATE_LIMITED", "Too many attempts. Try later.");
    }

    const ok = await verifyPassword(body.currentPassword, user.passwordHash);
    if (!ok) {
      await writeAudit({
        eventType: "PASSWORD_CHANGED",
        userId: user.id,
        observedIp: ip,
        message: "Password change failed: wrong current password",
        result: "failure",
      });
      throw new ApiError(403, "WRONG_PASSWORD", "Current password is incorrect.");
    }

    const policyErr = passwordPolicyError(body.newPassword);
    if (policyErr) throw new ApiError(400, "WEAK_PASSWORD", policyErr);

    if (await verifyPassword(body.newPassword, user.passwordHash)) {
      throw new ApiError(400, "SAME_PASSWORD", "New password must be different.");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.newPassword) },
    });

    // Invalidate every session (including this one), then mint a fresh one so
    // the user stays logged in on this device.
    await revokeAllUserSessions(user.id);
    const s = await createSession(user.id, {
      ip,
      userAgent: req.headers.get("user-agent"),
    });

    await writeAudit({
      eventType: "PASSWORD_CHANGED",
      userId: user.id,
      observedIp: ip,
      message: "Password changed; all other sessions revoked",
      result: "success",
    });

    return setSessionCookies(json({ ok: true }), s);
  },
);
