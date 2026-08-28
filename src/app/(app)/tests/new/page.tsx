"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "@/lib/clientApi";
import { Alert, Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface Target {
  id: string;
  name: string;
  hostname: string;
  port: number;
  protocol: string;
  authorizationStatus: string;
  authorizationReference: string;
  maxRequestsPerSecond: number;
  maxConcurrency: number;
  maxDurationSeconds: number;
}

export default function NewTestPage() {
  const router = useRouter();
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetId, setTargetId] = useState("");
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("/");
  const [rps, setRps] = useState(10);
  const [concurrency, setConcurrency] = useState(5);
  const [duration, setDuration] = useState(30);
  const [timeout, setTimeoutMs] = useState(10000);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    api<{ targets: Target[] }>("/api/targets").then((r) => setTargets(r.targets));
  }, []);

  const approved = useMemo(
    () => targets.filter((t) => t.authorizationStatus === "APPROVED"),
    [targets],
  );
  const target = targets.find((t) => t.id === targetId);
  const canStart = target?.authorizationStatus === "APPROVED";

  async function start() {
    setError(null);
    try {
      const res = await api<{ test: { id: string } }>("/api/tests", {
        json: {
          targetId,
          method,
          path,
          requestsPerSecond: Number(rps),
          concurrency: Number(concurrency),
          durationSeconds: Number(duration),
          requestTimeoutMs: Number(timeout),
        },
      });
      router.push(`/tests/${res.test.id}`);
    } catch (err) {
      setConfirm(false);
      setError(
        err instanceof ApiClientError
          ? `${err.message}${err.code ? ` (${err.code})` : ""}`
          : "Failed to start test",
      );
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">New load test</h1>

      <Alert kind="info">
        Tests may only run against targets with authorization status{" "}
        <strong>APPROVED</strong>. All rate, concurrency, and duration values are
        re-validated and clamped server-side against the platform and per-target
        limits — the values here are only a request.
      </Alert>

      {error && <Alert>{error}</Alert>}

      <Card title="Target">
        {approved.length === 0 ? (
          <p className="text-sm text-muted">
            No approved targets available. Ask an administrator to add and approve
            a target.
          </p>
        ) : (
          <Select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Select an approved target…</option>
            {approved.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {t.protocol.toLowerCase()}://{t.hostname}:{t.port}
              </option>
            ))}
          </Select>
        )}

        {target && (
          <div className="mt-3 rounded-lg border border-border p-3 text-xs">
            <div className="flex items-center gap-2">
              <Badge>{target.authorizationStatus}</Badge>
              <span className="text-muted">
                Ref: {target.authorizationReference}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-muted">
              <span>Max {target.maxRequestsPerSecond} rps</span>
              <span>Max {target.maxConcurrency} concurrency</span>
              <span>Max {target.maxDurationSeconds}s</span>
            </div>
          </div>
        )}
      </Card>

      <Card title="Request">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="Path" hint="Must stay on the target origin">
            <Input value={path} onChange={(e) => setPath(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title="Load profile">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Requests / sec">
            <Input type="number" min={1} value={rps} onChange={(e) => setRps(+e.target.value)} />
          </Field>
          <Field label="Concurrency">
            <Input
              type="number"
              min={1}
              value={concurrency}
              onChange={(e) => setConcurrency(+e.target.value)}
            />
          </Field>
          <Field label="Duration (s)">
            <Input
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(+e.target.value)}
            />
          </Field>
          <Field label="Timeout (ms)">
            <Input
              type="number"
              min={100}
              value={timeout}
              onChange={(e) => setTimeoutMs(+e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.push("/tests")}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!canStart}
          onClick={() => setConfirm(true)}
        >
          Start test
        </Button>
      </div>

      <ConfirmDialog
        open={confirm}
        danger
        title="Start load test?"
        confirmLabel="Start test"
        description={
          <div className="space-y-1">
            <p>
              You are about to generate load against{" "}
              <strong>
                {target?.hostname}:{target?.port}
              </strong>
              .
            </p>
            <p className="text-xs">
              Confirm you are authorized to test this target (reference{" "}
              <span className="font-mono">{target?.authorizationReference}</span>).
              This action is audited with your identity and server-observed IP.
            </p>
          </div>
        }
        onCancel={() => setConfirm(false)}
        onConfirm={start}
      />
    </div>
  );
}
