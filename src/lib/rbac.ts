import type { Role } from "@prisma/client";

export type Permission =
  | "users:manage"
  | "targets:manage"
  | "targets:view"
  | "safety:configure"
  | "tests:start"
  | "tests:stop:any"
  | "tests:stop:own"
  | "tests:view"
  | "telemetry:view"
  | "audit:view"
  | "emergency:stop";

const MATRIX: Record<Role, Permission[]> = {
  ADMIN: [
    "users:manage",
    "targets:manage",
    "targets:view",
    "safety:configure",
    "tests:start",
    "tests:stop:any",
    "tests:stop:own",
    "tests:view",
    "telemetry:view",
    "audit:view",
    "emergency:stop",
  ],
  OPERATOR: [
    "targets:view",
    "tests:start",
    "tests:stop:own",
    "tests:view",
    "telemetry:view",
  ],
  VIEWER: ["targets:view", "tests:view", "telemetry:view"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...MATRIX[role]];
}
