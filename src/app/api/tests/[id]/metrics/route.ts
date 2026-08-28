import { ApiError, defineHandler, json } from "@/lib/apiHandler";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export const GET = defineHandler(
  { auth: "required", permission: "telemetry:view" },
  async ({ params, req }) => {
    const test = await prisma.test.findUnique({
      where: { id: params.id },
      select: { id: true, status: true, summaryJson: true, startedAt: true, endedAt: true },
    });
    if (!test) throw new ApiError(404, "NOT_FOUND", "Test not found.");

    const since = req.nextUrl.searchParams.get("since");
    const metrics = await prisma.testMetric.findMany({
      where: {
        testId: params.id,
        ...(since ? { bucketStart: { gt: new Date(since) } } : {}),
      },
      orderBy: { bucketStart: "asc" },
      take: 1000,
    });

    return json({ test, metrics });
  },
);
