import type { Prisma, Test, TestStatus } from "@prisma/client";
import { prisma } from "./db";
import { assertTransition, InvalidTransitionError } from "./lifecycle";

/**
 * Guarded state transition.
 *
 * Two layers of protection against an invalid transition such as REJECTED -> RUNNING:
 *   1. `assertTransition` validates against the in-memory state machine.
 *   2. The DB `updateMany` is conditioned on `status = expectedFrom`, so a
 *      concurrent writer cannot slip a test past a check-then-act race.
 */
export async function transitionTest(
  testId: string,
  expectedFrom: TestStatus,
  to: TestStatus,
  data: Prisma.TestUpdateManyMutationInput = {},
): Promise<Test> {
  assertTransition(expectedFrom, to);
  const res = await prisma.test.updateMany({
    where: { id: testId, status: expectedFrom },
    data: { ...data, status: to },
  });
  if (res.count === 0) {
    const current = await prisma.test.findUnique({ where: { id: testId } });
    throw new InvalidTransitionError(current?.status ?? expectedFrom, to);
  }
  return prisma.test.findUniqueOrThrow({ where: { id: testId } });
}

/** Transition from any of several allowed source states (for stop/abort paths). */
export async function transitionTestFromAny(
  testId: string,
  allowedFrom: TestStatus[],
  to: TestStatus,
  data: Prisma.TestUpdateManyMutationInput = {},
): Promise<Test> {
  for (const from of allowedFrom) {
    try {
      assertTransition(from, to);
    } catch {
      // skip source states that cannot legally reach `to`
    }
  }
  const res = await prisma.test.updateMany({
    where: { id: testId, status: { in: allowedFrom } },
    data: { ...data, status: to },
  });
  if (res.count === 0) {
    const current = await prisma.test.findUnique({ where: { id: testId } });
    throw new InvalidTransitionError(current?.status ?? allowedFrom[0]!, to);
  }
  return prisma.test.findUniqueOrThrow({ where: { id: testId } });
}
