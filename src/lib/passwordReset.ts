import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";
import { env } from "./env";
import { hashPassword, passwordPolicyError } from "./password";
import { revokeAllUserSessions } from "./session";
import { sendEmail } from "./email";
import { writeAudit, tryWriteAudit } from "./audit";
import { logger } from "./logger";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export class ResetError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Begin a reset. Always succeeds from the caller's point of view (no account
 * enumeration). If the address maps to an active user, a single-use token is
 * created and emailed (or logged, if email is not configured).
 */
export async function requestPasswordReset(email: string, ip: string): Promise<void> {
  const normalized = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email: normalized } });

  if (!user || !user.isActive) {
    await tryWriteAudit({
      eventType: "PASSWORD_RESET_REQUESTED",
      observedIp: ip,
      message: `Reset requested for ${user ? "inactive" : "unknown"} address`,
      result: "ignored",
    });
    return;
  }

  // Invalidate any outstanding tokens for this user.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60_000);
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(rawToken),
      expiresAt,
      ipAtCreation: ip,
    },
  });

  const link = `${env.APP_URL.replace(/\/$/, "")}/reset-password?token=${rawToken}`;
  const text = [
    `A password reset was requested for your Authorized Load Tester account.`,
    ``,
    `Reset your password (link valid for ${env.PASSWORD_RESET_TTL_MINUTES} minutes):`,
    link,
    ``,
    `If you didn't request this, ignore this email - your password is unchanged.`,
  ].join("\n");

  const { delivered } = await sendEmail({
    to: user.email,
    subject: "Reset your Authorized Load Tester password",
    text,
  });

  await writeAudit({
    eventType: "PASSWORD_RESET_REQUESTED",
    userId: user.id,
    observedIp: ip,
    message: delivered
      ? "Reset link emailed"
      : "Reset link generated (email not configured - see server log / use CLI)",
    result: delivered ? "emailed" : "logged",
  });

  if (!delivered) {
    logger.warn("PASSWORD RESET LINK (email disabled)", { userId: user.id, link });
  }
}

/** Complete a reset with a raw token from the emailed link. */
export async function completePasswordReset(
  rawToken: string,
  newPassword: string,
  ip: string,
): Promise<void> {
  const policyErr = passwordPolicyError(newPassword);
  if (policyErr) throw new ResetError("WEAK_PASSWORD", policyErr);

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: sha256(rawToken) },
    include: { user: true },
  });

  if (
    !record ||
    record.usedAt ||
    record.expiresAt.getTime() < Date.now() ||
    !record.user.isActive
  ) {
    throw new ResetError("INVALID_TOKEN", "This reset link is invalid or has expired.");
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: await hashPassword(newPassword),
        failedLogins: 0,
        lockedUntil: null,
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);

  await revokeAllUserSessions(record.userId);

  await writeAudit({
    eventType: "PASSWORD_RESET",
    userId: record.userId,
    observedIp: ip,
    message: "Password reset via emailed link; all sessions revoked",
    result: "success",
  });
}
