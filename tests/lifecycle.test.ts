import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isTerminal,
} from "@/lib/lifecycle";

describe("test lifecycle state machine", () => {
  it("allows the happy path", () => {
    const path = [
      "CREATED",
      "AUTHORIZING",
      "AUTHORIZED",
      "STARTING",
      "RUNNING",
      "STOPPING",
      "COMPLETED",
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it("never allows REJECTED -> RUNNING", () => {
    expect(canTransition("REJECTED", "RUNNING")).toBe(false);
    expect(() => assertTransition("REJECTED", "RUNNING")).toThrow(InvalidTransitionError);
  });

  it("never allows resurrection from any terminal state", () => {
    for (const t of ["COMPLETED", "FAILED", "ABORTED", "REJECTED"] as const) {
      expect(isTerminal(t)).toBe(true);
      for (const to of ["RUNNING", "STARTING", "AUTHORIZED"] as const) {
        expect(canTransition(t, to)).toBe(false);
      }
    }
  });

  it("cannot skip authorization (CREATED -> RUNNING)", () => {
    expect(canTransition("CREATED", "RUNNING")).toBe(false);
  });
});
