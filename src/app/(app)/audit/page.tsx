"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { Alert, Badge, Card, EmptyState, Spinner } from "@/components/ui";

interface Log {
  id: string;
  eventType: string;
  observedIp: string | null;
  testId: string | null;
  targetId: string | null;
  message: string | null;
  result: string | null;
  failureReason: string | null;
  createdAt: string;
  user: { email: string; displayName: string } | null;
}

export default function AuditPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (reset = false) => {
      const params = new URLSearchParams({ limit: "100" });
      if (filter) params.set("eventType", filter);
      if (!reset && cursor) params.set("cursor", cursor);
      try {
        const r = await api<{ logs: Log[]; nextCursor: string | null }>(
          `/api/audit-logs?${params}`,
        );
        setLogs((prev) => (reset ? r.logs : [...prev, ...r.logs]));
        setCursor(r.nextCursor);
        setDone(!r.nextCursor);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load audit log");
      } finally {
        setLoading(false);
      }
    },
    [cursor, filter],
  );

  useEffect(() => {
    setLogs([]);
    setCursor(null);
    setDone(false);
    setLoading(true);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-lg border border-border bg-bg px-2 py-1 text-sm"
        >
          <option value="">All events</option>
          {[
            "LOGIN",
            "LOGIN_FAILED",
            "TEST_REQUESTED",
            "TEST_AUTHORIZED",
            "TEST_STARTED",
            "TEST_STOPPED",
            "TEST_REJECTED",
            "TEST_COMPLETED",
            "SAFETY_LIMIT_TRIGGERED",
            "EMERGENCY_STOP",
            "SERVICE_UNAVAILABLE",
            "TARGET_APPROVED",
          ].map((e) => (
            <option key={e}>{e}</option>
          ))}
        </select>
      </div>

      {error && <Alert>{error}</Alert>}

      <Card>
        {loading && logs.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Loading…
          </div>
        ) : logs.length === 0 ? (
          <EmptyState
            title={filter ? `No ${filter} events` : "No audit records yet"}
          />
        ) : (
          <div className="x-scroll -mx-1 px-1">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-left text-xs uppercase text-muted">
                <tr>
                  <th className="py-2 pr-4">Time</th>
                  <th className="py-2 pr-4">Event</th>
                  <th className="py-2 pr-4">Actor</th>
                  <th className="py-2 pr-4">IP</th>
                  <th className="py-2 pr-4">Detail</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t border-border align-top">
                    <td className="whitespace-nowrap py-2 pr-4 text-muted">
                      {new Date(l.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge>{l.eventType}</Badge>
                    </td>
                    <td className="py-2 pr-4">
                      {l.user ? l.user.email : "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {l.observedIp ?? "—"}
                    </td>
                    <td className="py-2 pr-4 text-muted">
                      {l.message}
                      {l.failureReason && (
                        <span className="text-red-500"> · {l.failureReason}</span>
                      )}
                      {l.testId && (
                        <span className="block font-mono text-xs">
                          test {l.testId.slice(0, 8)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!done && logs.length > 0 && (
          <button
            onClick={() => load()}
            className="mt-4 text-sm text-brand hover:underline"
          >
            Load more
          </button>
        )}
      </Card>
    </div>
  );
}
