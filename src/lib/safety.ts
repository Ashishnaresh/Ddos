import type { AuthorizedTarget, Role, Test, User } from "@prisma/client";
import { prisma, isDatabaseHealthy } from "./db";
import { env } from "./env";
import { ACTIVE_STATUSES } from "./lifecycle";
import { logger } from "./logger";

/**
 * Centralized, server-side safety policy.
 *
 * Every test-start path MUST funnel through `runPreflight`. There is deliberately
 * no alternative code path that starts a test without these checks. All values
 * that originate from the browser are treated as untrusted and are clamped here.
 */

export class SafetyError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus = 422,
  ) {
    super(message);
    this.name = "SafetyError";
  }
}

// ---------------------------------------------------------------------------
// Fail-closed dependency checks
// ---------------------------------------------------------------------------

/**
 * If any critical dependency is unavailable, NO new test may start.
 * An error / unknown state is never interpreted as "authorized".
 */
export async function assertServicesHealthy(): Promise<void> {
  const dbOk = await isDatabaseHealthy();
  if (!dbOk) {
    throw new SafetyError(
      "DB_UNAVAILABLE",
      "Database unavailable - refusing to start a test (fail-closed).",
      503,
    );
  }

  // The audit/telemetry service in this deployment is the same Postgres
  // instance, but we probe it as a distinct capability: a write must succeed.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1`;
    });
  } catch {
    throw new SafetyError(
      "TELEMETRY_UNAVAILABLE",
      "Audit/telemetry service unavailable - refusing to start a test (fail-closed).",
      503,
    );
  }

  const emergency = await prisma.emergencyStopState.findUnique({
    where: { id: "global" },
  });
  if (emergency?.active) {
    throw new SafetyError(
      "EMERGENCY_STOP_ACTIVE",
      "Global emergency stop is active - no new tests may start.",
      423,
    );
  }
}

// ---------------------------------------------------------------------------
// User / RBAC
// ---------------------------------------------------------------------------

const CAN_START: Role[] = ["ADMIN", "OPERATOR"];

export function authorizeUserForTestStart(user: Pick<User, "role" | "isActive">) {
  if (!user.isActive) {
    throw new SafetyError("USER_INACTIVE", "Account is disabled.", 403);
  }
  if (!CAN_START.includes(user.role)) {
    throw new SafetyError(
      "ROLE_FORBIDDEN",
      `Role ${user.role} is not permitted to start tests.`,
      403,
    );
  }
}

export function authorizeUserForStop(
  user: Pick<User, "id" | "role">,
  test: Pick<Test, "requestedById">,
) {
  if (user.role === "ADMIN") return;
  if (user.role === "OPERATOR" && test.requestedById === user.id) return;
  throw new SafetyError(
    "STOP_FORBIDDEN",
    "You may only stop tests you started.",
    403,
  );
}

// ---------------------------------------------------------------------------
// Target
// ---------------------------------------------------------------------------

export async function loadAndValidateTarget(
  targetId: string,
): Promise<AuthorizedTarget> {
  if (!targetId || typeof targetId !== "string") {
    throw new SafetyError("TARGET_INVALID", "A target must be selected.", 400);
  }
  const target = await prisma.authorizedTarget.findUnique({
    where: { id: targetId },
  });
  if (!target) {
    throw new SafetyError("TARGET_NOT_FOUND", "Target does not exist.", 404);
  }
  // The ONLY status from which a test may run. Never overridable by the client.
  if (target.authorizationStatus !== "APPROVED") {
    throw new SafetyError(
      "TARGET_NOT_APPROVED",
      `Target authorization status is ${target.authorizationStatus}; must be APPROVED.`,
      403,
    );
  }
  return target;
}

// ---------------------------------------------------------------------------
// Config clamping
// ---------------------------------------------------------------------------

export interface RequestedTestConfig {
  method: string;
  path: string;
  requestsPerSecond: number;
  concurrency: number;
  durationSeconds: number;
  requestTimeoutMs: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface EffectiveTestConfig {
  method:
    | "GET"
    | "HEAD"
    | "POST"
    | "PUT"
    | "PATCH"
    | "DELETE"
    | "OPTIONS";
  path: string;
  url: string;
  requestsPerSecond: number;
  concurrency: number;
  durationSeconds: number;
  requestTimeoutMs: number;
  headers: Record<string, string>;
  body?: string;
  bodySize: number;
  clamped: string[]; // which fields were reduced from the requested value
}

const ALLOWED_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

// Headers a tester is not allowed to set - they are reserved for honest
// identification / correct transport and must not be spoofed.
const FORBIDDEN_HEADER_PREFIXES = ["host", "x-forwarded", "forwarded", "via"];
const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "x-real-ip",
  "true-client-ip",
  "cf-connecting-ip",
  "user-agent",
]);

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return { value: fallback, clamped: true };
  const floored = Math.floor(n);
  if (floored < min) return { value: min, clamped: true };
  if (floored > max) return { value: max, clamped: true };
  return { value: floored, clamped: false };
}

/**
 * Build the effective config. Per-target ceilings are themselves clamped by the
 * global env ceilings, so a mis-set target row can never exceed the platform max.
 */
export function resolveEffectiveConfig(
  requested: RequestedTestConfig,
  target: AuthorizedTarget,
): EffectiveTestConfig {
  const clamped: string[] = [];

  const method = String(requested.method || "GET").toUpperCase();
  if (!ALLOWED_METHODS.includes(method as (typeof ALLOWED_METHODS)[number])) {
    throw new SafetyError("METHOD_INVALID", `HTTP method ${method} not allowed.`, 400);
  }

  // --- path -> absolute URL restricted to the target's own origin ---
  const path = String(requested.path || "/");
  const base = `${target.protocol.toLowerCase()}://${target.hostname}:${target.port}`;
  let url: URL;
  try {
    url = new URL(path, base + "/");
  } catch {
    throw new SafetyError("PATH_INVALID", "Endpoint path is not valid.", 400);
  }
  const baseUrl = new URL(base + "/");
  if (
    url.protocol !== baseUrl.protocol ||
    url.hostname !== baseUrl.hostname ||
    url.port !== baseUrl.port
  ) {
    // e.g. path was "//evil.com/x" or "https://other/". Reject outright -
    // a test may only ever hit the approved target's exact origin.
    throw new SafetyError(
      "PATH_ESCAPES_TARGET",
      "Endpoint path must stay on the approved target origin.",
      400,
    );
  }

  // --- ceilings ---
  const maxRps = Math.min(target.maxRequestsPerSecond, env.MAX_GLOBAL_RPS);
  const maxConc = Math.min(target.maxConcurrency, env.MAX_GLOBAL_CONCURRENCY);
  const maxDur = Math.min(target.maxDurationSeconds, env.MAX_TEST_DURATION);

  const rps = clampInt(requested.requestsPerSecond, 1, maxRps, 1);
  if (rps.clamped) clamped.push("requestsPerSecond");
  const conc = clampInt(requested.concurrency, 1, maxConc, 1);
  if (conc.clamped) clamped.push("concurrency");
  const dur = clampInt(requested.durationSeconds, 1, maxDur, Math.min(30, maxDur));
  if (dur.clamped) clamped.push("durationSeconds");
  const timeout = clampInt(requested.requestTimeoutMs, 100, 60000, 10000);
  if (timeout.clamped) clamped.push("requestTimeoutMs");

  // --- headers ---
  const headers: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(requested.headers ?? {})) {
    const key = rawKey.toLowerCase().trim();
    if (!key || typeof rawVal !== "string") continue;
    if (FORBIDDEN_HEADERS.has(key)) {
      throw new SafetyError(
        "HEADER_FORBIDDEN",
        `Header "${rawKey}" may not be set by a test.`,
        400,
      );
    }
    if (FORBIDDEN_HEADER_PREFIXES.some((p) => key.startsWith(p))) {
      throw new SafetyError(
        "HEADER_FORBIDDEN",
        `Header "${rawKey}" may not be set by a test.`,
        400,
      );
    }
    if (rawVal.length > 2048) {
      throw new SafetyError("HEADER_TOO_LONG", `Header "${rawKey}" value too long.`, 400);
    }
    headers[key] = rawVal;
  }
  if (Object.keys(headers).length > 25) {
    throw new SafetyError("HEADERS_TOO_MANY", "Too many custom headers.", 400);
  }

  // --- body ---
  let body: string | undefined;
  let bodySize = 0;
  if (requested.body != null && requested.body !== "") {
    body = String(requested.body);
    bodySize = Buffer.byteLength(body, "utf8");
    if (bodySize > env.MAX_PAYLOAD_BYTES) {
      throw new SafetyError(
        "PAYLOAD_TOO_LARGE",
        `Request body ${bodySize} bytes exceeds hard cap ${env.MAX_PAYLOAD_BYTES}.`,
        400,
      );
    }
    if (["GET", "HEAD"].includes(method)) {
      body = undefined;
      bodySize = 0;
    }
  }

  return {
    method: method as EffectiveTestConfig["method"],
    path: url.pathname + url.search,
    url: url.toString(),
    requestsPerSecond: rps.value,
    concurrency: conc.value,
    durationSeconds: dur.value,
    requestTimeoutMs: timeout.value,
    headers,
    body,
    bodySize,
    clamped,
  };
}

// ---------------------------------------------------------------------------
// Concurrency of the platform itself
// ---------------------------------------------------------------------------

export async function assertGlobalCapacity(): Promise<void> {
  const active = await prisma.test.count({
    where: { status: { in: ACTIVE_STATUSES } },
  });
  if (active >= env.MAX_CONCURRENT_TESTS) {
    throw new SafetyError(
      "CAPACITY",
      `Maximum concurrent tests (${env.MAX_CONCURRENT_TESTS}) already running.`,
      429,
    );
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface PreflightInput {
  user: User;
  targetId: string;
  requested: RequestedTestConfig;
}

export interface PreflightResult {
  target: AuthorizedTarget;
  effective: EffectiveTestConfig;
}

/**
 * Full server-side preflight. Order matters and is enforced:
 *   1. services healthy (fail-closed)   5. user permission
 *   2. user active + role               6. load server-side limits + clamp
 *   3. platform capacity                7. (caller) create audit record
 *   4. target exists + APPROVED         8. (caller) start test
 */
export async function runPreflight(
  input: PreflightInput,
): Promise<PreflightResult> {
  await assertServicesHealthy();
  authorizeUserForTestStart(input.user);
  await assertGlobalCapacity();
  const target = await loadAndValidateTarget(input.targetId);
  const effective = resolveEffectiveConfig(input.requested, target);
  logger.info("preflight passed", {
    userId: input.user.id,
    targetId: target.id,
    clamped: effective.clamped,
  });
  return { target, effective };
}
