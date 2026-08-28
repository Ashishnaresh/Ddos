import type { AuditEventType, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { logger } from "./logger";

/** Anything JSON-serializable; cast to Prisma's JSON input type at the boundary. */
type JsonMeta = unknown;

export interface AuditInput {
  eventType: AuditEventType;
  userId?: string | null;
  observedIp?: string | null;
  testId?: string | null;
  targetId?: string | null;
  sessionId?: string | null;
  message?: string;
  result?: string;
  failureReason?: string;
  metadata?: JsonMeta;
}

/**
 * Write an audit record. Audit rows are append-only (see schema + SECURITY.md).
 *
 * `writeAudit` throws on failure. Call sites that must fail-closed (test start)
 * should let it throw; best-effort call sites should use `tryWriteAudit`.
 */
export async function writeAudit(input: AuditInput) {
  return prisma.auditLog.create({
    data: {
      eventType: input.eventType,
      userId: input.userId ?? null,
      observedIp: input.observedIp ?? null,
      testId: input.testId ?? null,
      targetId: input.targetId ?? null,
      sessionId: input.sessionId ?? null,
      message: input.message,
      result: input.result,
      failureReason: input.failureReason,
      metadataJson:
        input.metadata === undefined
          ? undefined
          : (JSON.parse(JSON.stringify(input.metadata)) as Prisma.InputJsonValue),
    },
  });
}

export async function tryWriteAudit(input: AuditInput): Promise<void> {
  try {
    await writeAudit(input);
  } catch (err) {
    logger.error("audit write failed", {
      eventType: input.eventType,
      err: (err as Error).message,
    });
  }
}
