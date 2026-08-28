import type { User } from "@prisma/client";
import { prisma } from "./db";
import { hashPassword, passwordPolicyError, verifyPassword } from "./password";
import { writeAudit, tryWriteAudit } from "./audit";

const MAX_FAILED = 8;
const LOCK_MINUTES = 15;

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export async function registerUser(input: {
  email: string;
  displayName: string;
  password: string;
  ip: string;
}): Promise<User> {
  const email = input.email.toLowerCase().trim();
  const policyErr = passwordPolicyError(input.password);
  if (policyErr) throw new AuthError("WEAK_PASSWORD", policyErr);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Do not reveal whether the address is registered.
    throw new AuthError("EMAIL_TAKEN", "Unable to register with those details.");
  }

  // First ever user becomes ADMIN; everyone else starts as VIEWER and must be
  // promoted by an admin. No self-service privilege escalation.
  const userCount = await prisma.user.count();
  const role = userCount === 0 ? "ADMIN" : "VIEWER";

  const user = await prisma.user.create({
    data: {
      email,
      displayName: input.displayName.trim(),
      passwordHash: await hashPassword(input.password),
      role,
    },
  });

  await writeAudit({
    eventType: "USER_CREATED",
    userId: user.id,
    observedIp: input.ip,
    message: `User registered with role ${role}`,
    result: "success",
  });

  return user;
}

export async function authenticate(input: {
  email: string;
  password: string;
  ip: string;
}): Promise<User> {
  const email = input.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email } });

  const genericFail = new AuthError(
    "INVALID_CREDENTIALS",
    "Invalid email or password.",
  );

  if (!user) {
    // Spend comparable time to a real hash to blunt user enumeration.
    await verifyPassword(input.password, "scrypt$32768$8$1$AAAA$AAAA").catch(
      () => false,
    );
    await tryWriteAudit({
      eventType: "LOGIN_FAILED",
      observedIp: input.ip,
      message: `Login failed for unknown address`,
      result: "failure",
      failureReason: "unknown_user",
    });
    throw genericFail;
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await tryWriteAudit({
      eventType: "LOGIN_FAILED",
      userId: user.id,
      observedIp: input.ip,
      result: "failure",
      failureReason: "account_locked",
    });
    throw new AuthError(
      "ACCOUNT_LOCKED",
      "Account temporarily locked due to failed attempts. Try again later.",
    );
  }

  if (!user.isActive) {
    throw new AuthError("ACCOUNT_DISABLED", "Account is disabled.");
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: failed,
        lockedUntil:
          failed >= MAX_FAILED
            ? new Date(Date.now() + LOCK_MINUTES * 60_000)
            : null,
      },
    });
    await tryWriteAudit({
      eventType: "LOGIN_FAILED",
      userId: user.id,
      observedIp: input.ip,
      result: "failure",
      failureReason: failed >= MAX_FAILED ? "locked_now" : "bad_password",
    });
    throw genericFail;
  }

  if (user.failedLogins > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null },
    });
  }

  await writeAudit({
    eventType: "LOGIN",
    userId: user.id,
    observedIp: input.ip,
    result: "success",
  });

  return user;
}
