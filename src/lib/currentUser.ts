import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { resolveSession, SESSION_COOKIE } from "./session";
import { permissionsFor, type Permission } from "./rbac";

/** Server-component helper: resolve the authenticated user from the cookie. */
export async function getCurrentUser(): Promise<{
  user: User;
  permissions: Permission[];
} | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const resolved = await resolveSession(token);
  if (!resolved) return null;
  return { user: resolved.user, permissions: permissionsFor(resolved.user.role) };
}
