/**
 * Offline password reset — the guaranteed admin-lockout recovery path.
 *
 *   npm run reset-password -- <email> [newPassword]
 *
 * If newPassword is omitted a strong one is generated and printed once.
 * Requires DATABASE_URL (and DIRECT_URL) in the environment / .env, same as
 * `prisma migrate`. Also clears any lockout and revokes the user's sessions.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { hashPassword, passwordPolicyError } from "../src/lib/password";
import { revokeAllUserSessions } from "../src/lib/session";
import { writeAudit } from "../src/lib/audit";

async function main() {
  const [emailArg, pwArg] = process.argv.slice(2);
  if (!emailArg) {
    console.error("Usage: npm run reset-password -- <email> [newPassword]");
    process.exit(1);
  }
  const email = emailArg.toLowerCase().trim();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }

  let password = pwArg;
  if (!password) {
    // Generated: always satisfies the policy.
    password = "Reset-" + randomBytes(9).toString("base64url") + "9Aa";
  }
  const err = passwordPolicyError(password);
  if (err) {
    console.error(`Password rejected: ${err}`);
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(password),
      failedLogins: 0,
      lockedUntil: null,
      isActive: true,
    },
  });
  await revokeAllUserSessions(user.id);
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  await writeAudit({
    eventType: "PASSWORD_RESET",
    userId: user.id,
    message: "Password reset via CLI (scripts/reset-password.ts)",
    result: "success",
  });

  console.log(`\n  Password reset for ${user.email} (${user.role})`);
  if (!pwArg) console.log(`  New password: ${password}`);
  console.log(`  All sessions for this user were revoked.\n`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
