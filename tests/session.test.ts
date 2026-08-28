import { describe, expect, it } from "vitest";
import { csrfValid } from "@/lib/session";

describe("csrfValid - double submit cookie", () => {
  const secret = "the-session-csrf-secret";

  it("passes when cookie and header both equal the session secret", () => {
    expect(csrfValid(secret, secret, secret)).toBe(true);
  });

  it("fails when the header is missing", () => {
    expect(csrfValid(secret, null, secret)).toBe(false);
    expect(csrfValid(secret, undefined, secret)).toBe(false);
  });

  it("fails when the cookie value does not match the session secret", () => {
    expect(csrfValid("attacker-value", "attacker-value", secret)).toBe(false);
  });

  it("fails when header and cookie disagree", () => {
    expect(csrfValid(secret, "other", secret)).toBe(false);
  });
});
