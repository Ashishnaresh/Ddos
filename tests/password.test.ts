import { describe, expect, it } from "vitest";
import {
  hashPassword,
  passwordPolicyError,
  verifyPassword,
} from "@/lib/password";

describe("password hashing", () => {
  it("never stores plaintext and verifies round-trip", async () => {
    const hash = await hashPassword("CorrectHorse123");
    expect(hash).not.toContain("CorrectHorse123");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("CorrectHorse123", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("produces a distinct hash per call (random salt)", async () => {
    const a = await hashPassword("SamePass123");
    const b = await hashPassword("SamePass123");
    expect(a).not.toBe(b);
  });

  it("rejects malformed stored values without throwing", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });

  it("enforces the password policy", () => {
    expect(passwordPolicyError("short")).toMatch(/12 characters/);
    expect(passwordPolicyError("alllowercase1")).toMatch(/uppercase/);
    expect(passwordPolicyError("ALLUPPERCASE1")).toMatch(/lowercase/);
    expect(passwordPolicyError("NoDigitsHere")).toMatch(/digit/);
    expect(passwordPolicyError("ValidPass123")).toBeNull();
  });
});
