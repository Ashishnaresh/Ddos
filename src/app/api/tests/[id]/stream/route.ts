import { NextResponse } from "next/server";
import { ApiError, defineHandler } from "@/lib/apiHandler";
import { prisma } from "@/lib/db";
import { isTerminal } from "@/lib/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events telemetry stream for a single test.
 * Emits `metric` events for each new bucket and `status` events on change.
 * Auth + telemetry permission are enforced by defineHandler before streaming.
 */
export const GET = defineHandler(
  { auth: "required", permission: "telemetry:view" },
  async ({ params, req }) => {
    const test = await prisma.test.findUnique({
      where: { id: params.id },
      select: { id: true, status: true },
    });
    if (!test) throw new ApiError(404, "NOT_FOUND", "Test not found.");

    const encoder = new TextEncoder();
    let lastBucket: Date | null = null;
    let lastStatus = "";
    let closed = false;

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          if (closed) return;
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        };

        const tick = async () => {
          if (closed) return;
          try {
            const current = await prisma.test.findUnique({
              where: { id: params.id },
              select: { status: true, summaryJson: true },
            });
            if (!current) {
              send("error", { message: "test disappeared" });
              return stop();
            }
            const metrics = await prisma.testMetric.findMany({
              where: {
                testId: params.id,
                ...(lastBucket ? { bucketStart: { gt: lastBucket } } : {}),
              },
              orderBy: { bucketStart: "asc" },
              take: 50,
            });
            for (const m of metrics) {
              lastBucket = m.bucketStart;
              send("metric", m);
            }
            if (current.status !== lastStatus) {
              lastStatus = current.status;
              send("status", { status: current.status, summary: current.summaryJson });
            }
            if (isTerminal(current.status)) {
              send("done", { status: current.status, summary: current.summaryJson });
              return stop();
            }
          } catch {
            send("error", { message: "telemetry read failed" });
          }
        };

        const interval = setInterval(tick, 1000);
        const heartbeat = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
        }, 15000);

        function stop() {
          if (closed) return;
          closed = true;
          clearInterval(interval);
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }

        req.signal.addEventListener("abort", stop);
        await tick();
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  },
);
