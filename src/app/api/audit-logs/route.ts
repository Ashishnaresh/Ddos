import { defineHandler, json } from "@/lib/apiHandler";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Audit log access is restricted to ADMIN (audit:view). Ordinary operators and
 * viewers cannot read it - see rbac.ts.
 */
export const GET = defineHandler(
  { auth: "required", permission: "audit:view", roles: ["ADMIN"] },
  async ({ req }) => {
    const url = new URL(req.url);
    const take = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const eventType = url.searchParams.get("eventType") ?? undefined;

    const logs = await prisma.auditLog.findMany({
      where: eventType ? { eventType: eventType as never } : undefined,
      orderBy: { createdAt: "desc" },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { user: { select: { email: true, displayName: true } } },
    });

    const hasMore = logs.length > take;
    const page = hasMore ? logs.slice(0, take) : logs;
    return json({
      logs: page,
      nextCursor: hasMore ? page[page.length - 1]?.id : null,
    });
  },
);
