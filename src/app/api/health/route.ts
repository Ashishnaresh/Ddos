import { NextResponse } from "next/server";
import { isDatabaseHealthy } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await isDatabaseHealthy();
  return NextResponse.json(
    { status: db ? "ok" : "degraded", db, ts: new Date().toISOString() },
    { status: db ? 200 : 503 },
  );
}
