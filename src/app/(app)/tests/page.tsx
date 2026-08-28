"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/clientApi";
import { Badge, Card, EmptyState } from "@/components/ui";

interface TestRow {
  id: string;
  status: string;
  method: string;
  path: string;
  requestedAt: string;
  durationSeconds: number;
  summaryJson: {
    totalRequests: number;
    successes: number;
    latencyP95Ms: number;
  } | null;
  target: { name: string; hostname: string; port: number };
  requestedBy: { displayName: string };
}

export default function TestsPage() {
  const [tests, setTests] = useState<TestRow[]>([]);
  const [filter, setFilter] = useState<string>("");

  async function load() {
    const q = filter ? `?status=${filter}&limit=200` : "?limit=200";
    setTests((await api<{ tests: TestRow[] }>(`/api/tests${q}`)).tests);
  }

  useEffect(() => {
    load();
    const i = setInterval(load, 4000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Test history</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-lg border border-border bg-bg px-2 py-1 text-sm"
        >
          <option value="">All statuses</option>
          {["RUNNING", "COMPLETED", "ABORTED", "FAILED", "REJECTED"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <Card>
        {tests.length === 0 ? (
          <EmptyState title="No tests found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted">
                <tr>
                  <th className="py-2 pr-4">Test</th>
                  <th className="py-2 pr-4">Target</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Requests</th>
                  <th className="py-2 pr-4">Success</th>
                  <th className="py-2 pr-4">p95</th>
                  <th className="py-2 pr-4">By</th>
                  <th className="py-2 pr-4">Requested</th>
                </tr>
              </thead>
              <tbody>
                {tests.map((t) => {
                  const s = t.summaryJson;
                  return (
                    <tr key={t.id} className="border-t border-border">
                      <td className="py-2 pr-4 font-mono text-xs">
                        <Link href={`/tests/${t.id}`} className="text-brand hover:underline">
                          {t.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">{t.target.name}</td>
                      <td className="py-2 pr-4">
                        <Badge>{t.status}</Badge>
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {s?.totalRequests ?? "—"}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {s && s.totalRequests > 0
                          ? ((s.successes / s.totalRequests) * 100).toFixed(1) + "%"
                          : "—"}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {s ? Math.round(s.latencyP95Ms) + "ms" : "—"}
                      </td>
                      <td className="py-2 pr-4 text-muted">{t.requestedBy.displayName}</td>
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
