import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Session, User } from "@prisma/client";
import { prisma } from "./db";
import { env } from "./env";

export {
  SESSION_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
} from "./constants";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export interface NewSession {
  token: string; // raw token -> set as httpOnly cookie
  csrfSecret: string; // -> set as non-httpOnly cookie (double-submit)
  expiresAt: Date;
  session: Session;
}

export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<NewSession> {
  const token = randomBytes(32).toString("base64url");
  const csrfSecret = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_SECONDS * 1000);
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      csrfSecret,
      expiresAt,
      ipAtCreation: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
    },
  });
  return { token, csrfSecret, expiresAt, session };
}

export interface ResolvedSession {
  user: User;
  session: Session;
}

export async function resolveSession(
  token: string | undefined | null,
): Promise<ResolvedSession | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;
  if (!session.user.isActive) return null;

  // Idle timeout: no request for longer than the window => end the session.
  const idleMs = env.SESSION_IDLE_TIMEOUT_SECONDS * 1000;
  const idleFor = Date.now() - session.lastSeenAt.getTime();
  if (idleFor > idleMs) {
    await prisma.session
      .updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);
    return null;
  }

  // Sliding last-seen. Refresh often enough that the idle window is meaningful
  // but not on every single request.
  if (idleFor > 20_000) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  const { user, ...rest } = session;
  return { user, session: rest as Session };
}

export async function revokeSession(token: string | undefined | null) {
  if (!token) return;
  await prisma.session
    .updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    })
    .catch(() => undefined);
}

export async function revokeAllUserSessions(userId: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Constant-time double-submit CSRF check. */
export function csrfValid(
  cookieValue: string | undefined | null,
  headerValue: string | undefined | null,
  sessionSecret: string,
): boolean {
  if (!cookieValue || !headerValue) return false;
  const a = Buffer.from(cookieValue);
  const b = Buffer.from(headerValue);
  const c = Buffer.from(sessionSecret);
  if (a.length !== b.length || a.length !== c.length) return false;
  return timingSafeEqual(a, b) && timingSafeEqual(a, c);
}

export async function purgeExpiredSessions() {
  await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
  });
}
