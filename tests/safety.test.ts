import { describe, expect, it } from "vitest";
import {
  authorizeUserForStop,
  authorizeUserForTestStart,
  resolveEffectiveConfig,
  SafetyError,
  type RequestedTestConfig,
} from "@/lib/safety";
import { fakeTarget, fakeUser } from "./helpers";

const base: RequestedTestConfig = {
  method: "GET",
  path: "/",
  requestsPerSecond: 10,
  concurrency: 5,
  durationSeconds: 10,
  requestTimeoutMs: 5000,
};

describe("resolveEffectiveConfig - client values cannot bypass limits", () => {
  it("clamps absurd duration to the per-target ceiling", () => {
    const eff = resolveEffectiveConfig(
      { ...base, durationSeconds: 999_999 },
      fakeTarget({ maxDurationSeconds: 30 }),
    );
    expect(eff.durationSeconds).toBe(30);
    expect(eff.clamped).toContain("durationSeconds");
  });

  it("clamps rps to the global ceiling when the target ceiling is higher", () => {
    // global MAX_GLOBAL_RPS = 1000 in tests/setup.ts
    const eff = resolveEffectiveConfig(
      { ...base, requestsPerSecond: 50_000 },
      fakeTarget({ maxRequestsPerSecond: 100_000 }),
    );
    expect(eff.requestsPerSecond).toBe(1000);
  });

  it("clamps concurrency to the smaller of target and global", () => {
    const eff = resolveEffectiveConfig(
      { ...base, concurrency: 10_000 },
      fakeTarget({ maxConcurrency: 40 }),
    );
    expect(eff.concurrency).toBe(40);
  });

  it("rejects a path that escapes the target origin", () => {
    expect(() =>
      resolveEffectiveConfig({ ...base, path: "//evil.example/x" }, fakeTarget()),
    ).toThrow(SafetyError);
    expect(() =>
      resolveEffectiveConfig(
        { ...base, path: "https://evil.example/" },
        fakeTarget(),
      ),
    ).toThrow(/escapes|stay on the approved target/i);
  });

  it("rejects forbidden identity/transport headers", () => {
    for (const h of ["Host", "X-Forwarded-For", "X-Real-IP", "User-Agent"]) {
      expect(() =>
        resolveEffectiveConfig(
          { ...base, headers: { [h]: "spoof" } },
          fakeTarget(),
        ),
      ).toThrow(SafetyError);
    }
  });

  it("rejects a payload above the hard byte cap", () => {
    expect(() =>
      resolveEffectiveConfig(
        { ...base, method: "POST", body: "x".repeat(5000) }, // cap is 4096 in tests
        fakeTarget(),
      ),
    ).toThrow(/PAYLOAD_TOO_LARGE|exceeds hard cap/);
  });

  it("drops a body on GET/HEAD", () => {
    const eff = resolveEffectiveConfig(
      { ...base, method: "GET", body: "hello" },
      fakeTarget(),
    );
    expect(eff.body).toBeUndefined();
    expect(eff.bodySize).toBe(0);
  });

  it("builds an absolute URL restricted to the target origin", () => {
    const eff = resolveEffectiveConfig(
      { ...base, path: "/api/health?x=1" },
      fakeTarget({ protocol: "HTTPS", hostname: "h.example", port: 8443 }),
    );
    expect(eff.url).toBe("https://h.example:8443/api/health?x=1");
  });
});

describe("RBAC in the safety layer", () => {
  it("forbids a VIEWER from starting tests", () => {
    expect(() =>
      authorizeUserForTestStart(fakeUser({ role: "VIEWER" })),
    ).toThrow(/not permitted/i);
  });

  it("forbids an inactive OPERATOR", () => {
    expect(() =>
      authorizeUserForTestStart(fakeUser({ role: "OPERATOR", isActive: false })),
    ).toThrow(/disabled/i);
  });

  it("allows OPERATOR and ADMIN", () => {
    expect(() => authorizeUserForTestStart(fakeUser({ role: "OPERATOR" }))).not.toThrow();
    expect(() => authorizeUserForTestStart(fakeUser({ role: "ADMIN" }))).not.toThrow();
  });

  it("operator may stop only their own test; admin may stop any", () => {
    const op = fakeUser({ id: "op1", role: "OPERATOR" });
    expect(() => authorizeUserForStop(op, { requestedById: "op1" })).not.toThrow();
    expect(() => authorizeUserForStop(op, { requestedById: "op2" })).toThrow();
    expect(() =>
      authorizeUserForStop(fakeUser({ role: "ADMIN" }), { requestedById: "x" }),
    ).not.toThrow();
  });
});
