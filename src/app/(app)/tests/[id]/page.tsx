"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/clientApi";
import { Alert, Badge, Button, Card, Spinner, Stat } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import {
  ErrorsChart,
  LatencyChart,
  RpsChart,
  type MetricPoint,
} from "@/components/Charts";

interface Test {
  id: string;
  status: string;
  method: string;
  path: string;
  requestsPerSecond: number;
  concurrency: number;
  durationSeconds: number;
  requestTimeoutMs: number;
  observedIp: string;
  sessionId: string;
  targetHostname: string;
  targetPort: number;
  stopReason: string | null;
  requestedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  summaryJson: Summary | null;
  requestedConfigJson: Record<string, unknown>;
  target: {
    name: string;
    authorizationStatus: string;
    authorizationReference: string;
  };
  requestedBy: { displayName: string; email: string };
}
interface Summary {
  totalRequests: number;
  successes: number;
  failures: number;
  timeouts: number;
  errors: number;
  statusCounts: Record<string, number>;
  avgRps: number;
  latencyAvgMs: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  latencyMaxMs: number;
  durationMs: number;
}

const TERMINAL = ["COMPLETED", "ABORTED", "FAILED", "REJECTED"];

export default function TestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [test, setTest] = useState<Test | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [points, setPoints] = useState<MetricPoint[]>([]);
  const [confirmStop, setConfirmStop] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    api<{ test: Test }>(`/api/tests/${id}`)
      .then((r) => setTest(r.test))
      .catch(() => setNotFound(true));
    api<{ metrics: RawMetric[] }>(`/api/tests/${id}/metrics`)
      .then((r) => setPoints(r.metrics.map(toPoint)))
      .catch(() => undefined);
  }, [id]);

  useEffect(() => {
    if (!test || TERMINAL.includes(test.status)) return;

    // Serverless safety net: keep the worker moving / recover a killed tick.
    const nudge = () =>
      api("/api/worker/nudge", { method: "POST" }).catch(() => undefined);
    nudge();
    const nudgeTimer = setInterval(nudge, 12000);

    const es = new EventSource(`/api/tests/${id}/stream`);
    esRef.current = es;
    es.addEventListener("metric", (e) => {
      const m = JSON.parse((e as MessageEvent).data) as RawMetric;
      setPoints((p) => [...p, toPoint(m)].slice(-600));
    });
    es.addEventListener("status", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { status: string };
      setTest((t) => (t ? { ...t, status: d.status } : t));
    });
    es.addEventListener("done", () => {
      es.close();
      api<{ test: Test }>(`/api/tests/${id}`).then((r) => setTest(r.test));
    });
    es.onerror = () => {
      /* browser auto-reconnects; nothing to do */
    };
    return () => {
      es.close();
      clearInterval(nudgeTimer);
    };
  }, [test?.status, id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (notFound) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">Test not found</h1>
        <p className="text-sm text-muted">
          This test doesn&apos;t exist or you don&apos;t have access to it.
        </p>
        <a href="/tests" className="text-sm text-brand hover:underline">
          ← Back to tests
        </a>
      </div>
    );
  }

  if (!test)
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Loading test…
      </div>
    );

  const s = test.summaryJson;
  const live = !TERMINAL.includes(test.status);
  const latest = points[points.length - 1];
  const totalReq = s?.totalRequests ?? points.reduce((a, p) => a + p.successes + p.failures, 0);
  const totalOk = s?.successes ?? points.reduce((a, p) => a + p.successes, 0);
  const successRate = totalReq > 0 ? ((totalOk / totalReq) * 100).toFixed(1) + "%" : "—";

  async function stop() {
    setErr(null);
    try {
      await api(`/api/tests/${id}/stop`, {
        json: { reason: "Operator stopped from console" },
      });
      setConfirmStop(false);
      toast.success("Stop requested — draining in-flight requests");
      const r = await api<{ test: Test }>(`/api/tests/${id}`);
      setTest(r.test);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Stop failed";
      setErr(msg);
      toast.error(msg);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{test.target.name}</h1>
          <p className="break-anywhere font-mono text-xs text-muted">
            {test.method}{" "}
            {test.targetHostname}:{test.targetPort}
            {test.path}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{test.status}</Badge>
          {live && test.status !== "REJECTED" && (
            <Button variant="danger" onClick={() => setConfirmStop(true)}>
              Stop test
            </Button>
          )}
        </div>
      </div>

      {err && <Alert>{err}</Alert>}
      {test.stopReason && (
        <Alert kind={test.status === "COMPLETED" ? "info" : "warn"}>
          Stop reason: {test.stopReason}
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Current RPS" value={live ? Math.round(latest?.rps ?? 0) : Math.round(s?.avgRps ?? 0)} />
        <Stat label="Total requests" value={totalReq} />
        <Stat label="Success rate" value={successRate} />
        <Stat
          label="p95 latency"
          value={(s ? Math.round(s.latencyP95Ms) : Math.round(latest?.latencyP95 ?? 0)) + "ms"}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Requests / sec">
          <RpsChart data={points} />
        </Card>
        <Card title="Latency (p50 / p95 / p99)">
          <LatencyChart data={points} />
        </Card>
        <Card title="Errors & timeouts">
          <ErrorsChart data={points} />
        </Card>
        <Card title="Status codes">
          <StatusCodes summary={s} points={points} />
        </Card>
      </div>

      <Card title="Configuration (effective, after server-side clamping)">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
          <Row k="Requests/sec" v={test.requestsPerSecond} />
          <Row k="Concurrency" v={test.concurrency} />
          <Row k="Duration" v={`${test.durationSeconds}s`} />
          <Row k="Request timeout" v={`${test.requestTimeoutMs}ms`} />
          <Row k="Requested by" v={test.requestedBy.displayName} />
          <Row k="Server-observed IP" v={test.observedIp} />
          <Row k="Session" v={test.sessionId.slice(0, 12) + "…"} />
          <Row k="Authorization ref" v={test.target.authorizationReference} />
          <Row k="Requested at" v={new Date(test.requestedAt).toLocaleString()} />
        </dl>
      </Card>

      {s && (
        <Card title="Final summary">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
            <Row k="Total" v={s.totalRequests} />
            <Row k="Successes" v={s.successes} />
            <Row k="Failures" v={s.failures} />
            <Row k="Timeouts" v={s.timeouts} />
            <Row k="Errors" v={s.errors} />
            <Row k="Avg RPS" v={s.avgRps.toFixed(1)} />
            <Row k="Avg latency" v={`${s.latencyAvgMs.toFixed(1)}ms`} />
            <Row k="p50" v={`${s.latencyP50Ms.toFixed(0)}ms`} />
            <Row k="p95" v={`${s.latencyP95Ms.toFixed(0)}ms`} />
            <Row k="p99" v={`${s.latencyP99Ms.toFixed(0)}ms`} />
            <Row k="Max" v={`${s.latencyMaxMs.toFixed(0)}ms`} />
            <Row k="Duration" v={`${(s.durationMs / 1000).toFixed(1)}s`} />
          </dl>
        </Card>
      )}

      <ConfirmDialog
        open={confirmStop}
        danger
        title="Stop this test?"
        confirmLabel="Stop test"
        description="The worker will stop generating requests, drain in-flight requests, and mark the test ABORTED. This is audited."
        onCancel={() => setConfirmStop(false)}
        onConfirm={stop}
      />
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/50 py-1">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className="break-anywhere text-right font-mono">{v}</dd>
    </div>
  );
}

function StatusCodes({
  summary,
  points,
}: {
  summary: Summary | null;
  points: MetricPoint[];
}) {
  const counts: Record<string, number> = summary?.statusCounts
    ? { ...summary.statusCounts }
    : {};
  if (!summary) {
    for (const p of points) {
      void p;
    }
  }
  const entries = Object.entries(counts).sort();
  if (entries.length === 0)
    return <p className="text-sm text-muted">No responses recorded yet.</p>;
  const total = entries.reduce((a, [, n]) => a + n, 0);
  return (
    <div className="space-y-2">
      {entries.map(([code, n]) => (
        <div key={code}>
          <div className="flex justify-between text-xs">
            <span className="font-mono">{code}</span>
            <span className="text-muted">{n}</span>
          </div>
          <div className="mt-1 h-2 rounded bg-bg">
            <div
              className="h-2 rounded bg-brand"
              style={{ width: `${(n / total) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

interface RawMetric {
  bucketStart: string;
  requestsPerSecond: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  errors: number;
  timeouts: number;
  successes: number;
  failures: number;
}

function toPoint(m: RawMetric): MetricPoint {
  return {
    t: new Date(m.bucketStart).toLocaleTimeString(),
    rps: m.requestsPerSecond,
    latencyP50: m.latencyP50Ms,
    latencyP95: m.latencyP95Ms,
    latencyP99: m.latencyP99Ms,
    errors: m.errors,
    timeouts: m.timeouts,
    successes: m.successes,
    failures: m.failures,
  };
}
