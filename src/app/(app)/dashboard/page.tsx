"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/clientApi";
import { Badge, Card, EmptyState, Stat } from "@/components/ui";

interface TestRow {
  id: string;
  status: string;
  method: string;
  path: string;
  requestsPerSecond: number;
  concurrency: number;
  durationSeconds: number;
  requestedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  summaryJson: Summary | null;
  target: { name: string; hostname: string; port: number };
  requestedBy: { displayName: string };
}
interface Summary {
  totalRequests: number;
  successes: number;
  failures: number;
  latencyP95Ms: number;
  avgRps: number;
}

const ACTIVE = ["AUTHORIZING", "AUTHORIZED", "STARTING", "RUNNING", "STOPPING"];

export default function DashboardPage() {
  const [tests, setTests] = useState<TestRow[]>([]);
  const [emergency, setEmergency] = useState<{ active: boolean; reason?: string | null } | null>(null);

  async function load() {
    const [t, e] = await Promise.all([
      api<{ tests: TestRow[] }>("/api/tests?limit=100"),
      api<{ state: { active: boolean; reason?: string | null } }>("/api/admin/emergency-stop"),
    ]);
    setTests(t.tests);
    setEmergency(e.state);
    // On serverless deployments this keeps the worker moving if a kick was missed.
    if (t.tests.some((x) => ACTIVE.includes(x.status))) {
      api("/api/worker/nudge", { method: "POST" }).catch(() => undefined);
    }
  }

  useEffect(() => {
    load();
    const i = setInterval(load, 3000);
    return () => clearInterval(i);
  }, []);

  const active = tests.filter((t) => ACTIVE.includes(t.status));
  const completed = tests.filter((t) => !ACTIVE.includes(t.status));
  const last24 = tests.filter(
    (t) => Date.now() - new Date(t.requestedAt).getTime() < 86_400_000,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <Link href="/tests/new" className="text-sm text-brand hover:underline">
          New test →
        </Link>
      </div>

      {emergency?.active && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          <strong>Global emergency stop is ACTIVE.</strong> No new tests can
          start. {emergency.reason ? `Reason: ${emergency.reason}` : ""}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active tests" value={active.length} />
        <Stat label="Requests (24h)" value={last24.reduce((s, t) => s + (t.summaryJson?.totalRequests ?? 0), 0)} />
        <Stat label="Tests (24h)" value={last24.length} />
        <Stat
          label="Failures (24h)"
          value={last24.reduce((s, t) => s + (t.summaryJson?.failures ?? 0), 0)}
        />
      </div>

      <Card title="Active tests">
        {active.length === 0 ? (
          <EmptyState title="No active tests" hint="Start one from the New test page." />
        ) : (
          <div className="space-y-2">
            {active.map((t) => (
              <TestLine key={t.id} t={t} live />
            ))}
          </div>
        )}
      </Card>

      <Card title="Recent history">
        {completed.length === 0 ? (
          <EmptyState title="No completed tests yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted">
                <tr>
                  <th className="py-2 pr-4">Target</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Requests</th>
                  <th className="py-2 pr-4">Success</th>
                  <th className="py-2 pr-4">p95</th>
                  <th className="py-2 pr-4">Requested</th>
                </tr>
              </thead>
              <tbody>
                {completed.slice(0, 20).map((t) => {
                  const s = t.summaryJson;
                  const sr = s && s.totalRequests > 0
                    ? ((s.successes / s.totalRequests) * 100).toFixed(1) + "%"
                    : "—";
                  return (
                    <tr key={t.id} className="border-t border-border">
                      <td className="py-2 pr-4">
                        <Link href={`/tests/${t.id}`} className="text-brand hover:underline">
                          {t.target.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-4"><Badge>{t.status}</Badge></td>
                      <td className="py-2 pr-4 tabular-nums">{s?.totalRequests ?? "—"}</td>
                      <td className="py-2 pr-4 tabular-nums">{sr}</td>
                      <td className="py-2 pr-4 tabular-nums">
                        {s ? Math.round(s.latencyP95Ms) + "ms" : "—"}
                      </td>
                      <td className="py-2 pr-4 text-muted">
                        {new Date(t.requestedAt).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function TestLine({ t }: { t: TestRow; live?: boolean }) {
  return (
    <Link
      href={`/tests/${t.id}`}
      className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm hover:bg-bg"
    >
      <div className="min-w-0">
        <div className="truncate font-medium">
          {t.target.name}{" "}
          <span className="font-mono text-xs text-muted">
            {t.method} {t.path}
          </span>
        </div>
        <div className="text-xs text-muted">
          {t.requestsPerSecond} rps · {t.concurrency} conc · {t.durationSeconds}s ·{" "}
          {t.requestedBy.displayName}
        </div>
      </div>
      <Badge>{t.status}</Badge>
    </Link>
  );
}
