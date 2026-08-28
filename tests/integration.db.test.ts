/**
 * Integration tests that need a real Postgres. They are SKIPPED unless
 * RUN_DB_TESTS=1 and a migrated test database is reachable via DATABASE_URL.
 *
 *   createdb loadtester_test
 *   DATABASE_URL=postgres://.../loadtester_test npm run prisma:deploy
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://.../loadtester_test npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1";

const d = RUN ? describe : describe.skip;

d("full server-side safety pipeline", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let runPreflight: typeof import("@/lib/safety").runPreflight;
  let SafetyError: typeof import("@/lib/safety").SafetyError;
  let transitionTest: typeof import("@/lib/testRepo").transitionTest;
  let InvalidTransitionError: typeof import("@/lib/lifecycle").InvalidTransitionError;
  let adminId = "";

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ runPreflight, SafetyError } = await import("@/lib/safety"));
    ({ transitionTest } = await import("@/lib/testRepo"));
    ({ InvalidTransitionError } = await import("@/lib/lifecycle"));
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.testMetric.deleteMany();
    await prisma.test.deleteMany();
    await prisma.authorizedTarget.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.emergencyStopState.deleteMany();
    const admin = await prisma.user.create({
      data: {
        email: "a@test.local",
        displayName: "A",
        role: "ADMIN",
        passwordHash: "x",
      },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function makeTarget(status: "APPROVED" | "PENDING" | "SUSPENDED" | "REVOKED") {
    return prisma.authorizedTarget.create({
      data: {
        name: "t",
        hostname: "svc.local",
        protocol: "HTTP",
        port: 8080,
        owner: "team",
        authorizationStatus: status,
        authorizationReference: "REF",
        maxRequestsPerSecond: 50,
        maxConcurrency: 10,
        maxDurationSeconds: 20,
        createdById: adminId,
      },
    });
  }

  it("rejects a test against a non-APPROVED target", async () => {
    for (const status of ["PENDING", "SUSPENDED", "REVOKED"] as const) {
      const target = await makeTarget(status);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: adminId } });
      await expect(
        runPreflight({
          user,
          targetId: target.id,
          requested: {
            method: "GET",
            path: "/",
            requestsPerSecond: 5,
            concurrency: 2,
            durationSeconds: 5,
            requestTimeoutMs: 1000,
          },
        }),
      ).rejects.toThrow(/APPROVED/);
      await prisma.authorizedTarget.deleteMany();
    }
  });

  it("clamps client values to server limits during preflight", async () => {
    const target = await makeTarget("APPROVED");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: adminId } });
    const { effective } = await runPreflight({
      user,
      targetId: target.id,
      requested: {
        method: "GET",
        path: "/",
        requestsPerSecond: 999999,
        concurrency: 999999,
        durationSeconds: 999999,
        requestTimeoutMs: 1000,
      },
    });
    expect(effective.requestsPerSecond).toBe(50);
    expect(effective.concurrency).toBe(10);
    expect(effective.durationSeconds).toBe(20);
  });

  it("fails closed while the global emergency stop is active", async () => {
    await prisma.emergencyStopState.create({
      data: { id: "global", active: true, reason: "test" },
    });
    const target = await makeTarget("APPROVED");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: adminId } });
    await expect(
      runPreflight({
        user,
        targetId: target.id,
        requested: {
          method: "GET",
          path: "/",
          requestsPerSecond: 1,
          concurrency: 1,
          durationSeconds: 1,
          requestTimeoutMs: 1000,
        },
      }),
    ).rejects.toBeInstanceOf(SafetyError);
  });

  it("guarded DB transition blocks REJECTED -> RUNNING", async () => {
    const target = await makeTarget("APPROVED");
    const test = await prisma.test.create({
      data: {
        status: "REJECTED",
        targetId: target.id,
        requestedById: adminId,
        method: "GET",
        path: "/",
        requestsPerSecond: 1,
        concurrency: 1,
        durationSeconds: 1,
        requestTimeoutMs: 1000,
        requestedConfigJson: {},
        sessionId: "s",
        observedIp: "127.0.0.1",
        targetHostname: "svc.local",
        targetPort: 8080,
      },
    });
    await expect(
      transitionTest(test.id, "RUNNING", "COMPLETED"),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
    // even if a caller lies about expectedFrom, the row status guard saves us
    const after = await prisma.test.findUniqueOrThrow({ where: { id: test.id } });
    expect(after.status).toBe("REJECTED");
  });

  it("enforces the platform concurrent-test ceiling (3 in tests)", async () => {
    const target = await makeTarget("APPROVED");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: adminId } });
    for (let i = 0; i < 3; i++) {
      await prisma.test.create({
        data: {
          status: "RUNNING",
          targetId: target.id,
          requestedById: adminId,
          method: "GET",
          path: "/",
          requestsPerSecond: 1,
          concurrency: 1,
          durationSeconds: 1,
          requestTimeoutMs: 1000,
          requestedConfigJson: {},
          sessionId: "s",
          observedIp: "127.0.0.1",
          targetHostname: "svc.local",
          targetPort: 8080,
        },
      });
    }
    await expect(
      runPreflight({
        user,
        targetId: target.id,
        requested: {
          method: "GET",
          path: "/",
          requestsPerSecond: 1,
          concurrency: 1,
          durationSeconds: 1,
          requestTimeoutMs: 1000,
        },
      }),
    ).rejects.toThrow(/concurrent tests/i);
  });
});
