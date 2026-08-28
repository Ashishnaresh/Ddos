import type { AuthorizedTarget, User } from "@prisma/client";

export function fakeTarget(overrides: Partial<AuthorizedTarget> = {}): AuthorizedTarget {
  return {
    id: "t_1",
    name: "Test target",
    hostname: "app.internal.example",
    protocol: "HTTPS",
    port: 443,
    owner: "team",
    authorizationStatus: "APPROVED",
    authorizationReference: "TICKET-1",
    notes: null,
    maxRequestsPerSecond: 100,
    maxConcurrency: 20,
    maxDurationSeconds: 30,
    createdById: "u_admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u_1",
    email: "op@example.com",
    passwordHash: "x",
    role: "OPERATOR",
    displayName: "Op",
    isActive: true,
    failedLogins: 0,
    lockedUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
