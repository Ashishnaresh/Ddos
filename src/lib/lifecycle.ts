import type { TestStatus } from "@prisma/client";

/**
 * Test lifecycle state machine.
 *
 *   CREATED -> AUTHORIZING -> AUTHORIZED -> STARTING -> RUNNING -> STOPPING -> {COMPLETED, ABORTED}
 *      |            |             |            |           |
 *      +------------+-------------+------------+-----------+--> REJECTED / FAILED
 *
 * Invalid transitions (e.g. REJECTED -> RUNNING) are rejected by
 * `assertTransition` and by a guarded conditional DB update in testRepo.ts.
 */
const TRANSITIONS: Record<TestStatus, TestStatus[]> = {
  CREATED: ["AUTHORIZING", "REJECTED", "FAILED"],
  AUTHORIZING: ["AUTHORIZED", "REJECTED", "FAILED"],
  AUTHORIZED: ["STARTING", "REJECTED", "FAILED", "ABORTED"],
  STARTING: ["RUNNING", "FAILED", "ABORTED", "STOPPING"],
  RUNNING: ["STOPPING", "COMPLETED", "FAILED", "ABORTED"],
  STOPPING: ["COMPLETED", "ABORTED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
  ABORTED: [],
  REJECTED: [],
};

export const TERMINAL_STATUSES: TestStatus[] = [
  "COMPLETED",
  "FAILED",
  "ABORTED",
  "REJECTED",
];

export const ACTIVE_STATUSES: TestStatus[] = [
  "AUTHORIZING",
  "AUTHORIZED",
  "STARTING",
  "RUNNING",
  "STOPPING",
];

export function isTerminal(status: TestStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: TestStatus, to: TestStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidTransitionError extends Error {
  constructor(
    public from: TestStatus,
    public to: TestStatus,
  ) {
    super(`Invalid test state transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: TestStatus, to: TestStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}
