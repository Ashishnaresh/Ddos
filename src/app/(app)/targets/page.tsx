"use client";

import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/clientApi";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
} from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";

interface Target {
  id: string;
  name: string;
  hostname: string;
  protocol: string;
  port: number;
  owner: string;
  authorizationStatus: string;
  authorizationReference: string;
  notes: string | null;
  maxRequestsPerSecond: number;
  maxConcurrency: number;
  maxDurationSeconds: number;
  _count?: { tests: number };
}

const EMPTY = {
  name: "",
  hostname: "",
  protocol: "HTTPS",
  port: 443,
  owner: "",
  authorizationReference: "",
  notes: "",
  maxRequestsPerSecond: 100,
  maxConcurrency: 20,
  maxDurationSeconds: 60,
};

export default function TargetsPage() {
  const toast = useToast();
  const [targets, setTargets] = useState<Target[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; status: string } | null>(null);

  async function load() {
    try {
      const r = await api<{ targets: Target[]; canManage: boolean }>("/api/targets");
      setTargets(r.targets);
      setCanManage(r.canManage);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Failed to load targets");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const payload = {
      ...form,
      port: Number(form.port),
      maxRequestsPerSecond: Number(form.maxRequestsPerSecond),
      maxConcurrency: Number(form.maxConcurrency),
      maxDurationSeconds: Number(form.maxDurationSeconds),
      notes: form.notes || undefined,
    };
    try {
      if (editingId) {
        await api(`/api/targets/${editingId}`, { method: "PATCH", json: payload });
        toast.success("Target updated");
      } else {
        await api("/api/targets", { json: payload });
        toast.success("Target added — it starts as PENDING until approved");
      }
      setForm({ ...EMPTY });
      setEditingId(null);
      await load();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : "Save failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(id: string, status: string) {
    setError(null);
    try {
      await api(`/api/targets/${id}`, {
        method: "PATCH",
        json: { authorizationStatus: status },
      });
      toast.success(`Target set to ${status}`);
      await load();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : "Update failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Authorized targets</h1>
      <Alert kind="info">
        A test can run <strong>only</strong> against a target with status
        APPROVED. Approval is a deliberate admin action and is recorded in the
        audit log together with the authorization reference.
      </Alert>
      {error && <Alert>{error}</Alert>}

      {canManage && (
        <Card title={editingId ? "Edit target" : "Add target"}>
          <form
            onSubmit={save}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3"
          >
            <Field label="Name">
              <Input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Hostname / IP">
              <Input
                required
                value={form.hostname}
                onChange={(e) => setForm({ ...form, hostname: e.target.value })}
              />
            </Field>
            <Field label="Protocol">
              <Select
                value={form.protocol}
                onChange={(e) => setForm({ ...form, protocol: e.target.value })}
              >
                <option>HTTPS</option>
                <option>HTTP</option>
              </Select>
            </Field>
            <Field label="Port">
              <Input
                type="number"
                required
                value={form.port}
                onChange={(e) => setForm({ ...form, port: +e.target.value })}
              />
            </Field>
            <Field label="Owner">
              <Input
                required
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
              />
            </Field>
            <Field label="Authorization reference" hint="Ticket / contract / written approval">
              <Input
                required
                value={form.authorizationReference}
                onChange={(e) =>
                  setForm({ ...form, authorizationReference: e.target.value })
                }
              />
            </Field>
            <Field label="Max requests / sec">
              <Input
                type="number"
                value={form.maxRequestsPerSecond}
                onChange={(e) =>
                  setForm({ ...form, maxRequestsPerSecond: +e.target.value })
                }
              />
            </Field>
            <Field label="Max concurrency">
              <Input
                type="number"
                value={form.maxConcurrency}
                onChange={(e) => setForm({ ...form, maxConcurrency: +e.target.value })}
              />
            </Field>
            <Field label="Max duration (s)">
              <Input
                type="number"
                value={form.maxDurationSeconds}
                onChange={(e) =>
                  setForm({ ...form, maxDurationSeconds: +e.target.value })
                }
              />
            </Field>
            <div className="flex items-end gap-2 sm:col-span-2 md:col-span-3">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving
                  ? "Saving…"
                  : editingId
                    ? "Save changes"
                    : "Add target (starts PENDING)"}
              </Button>
              {editingId && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditingId(null);
                    setForm({ ...EMPTY });
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading targets…
        </div>
      ) : targets.length === 0 ? (
        <EmptyState
          title="No targets yet"
          hint={
            canManage
              ? "Add a target above, then approve it before tests can run."
              : "An administrator needs to add and approve a target."
          }
        />
      ) : (
        <div className="space-y-3">
          {targets.map((t) => (
          <Card key={t.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  <Badge>{t.authorizationStatus}</Badge>
                </div>
                <div className="mt-1 break-anywhere font-mono text-xs text-muted">
                  {t.protocol.toLowerCase()}://{t.hostname}:{t.port}
                </div>
                <div className="mt-1 text-xs text-muted">
                  Owner: {t.owner} · Ref: {t.authorizationReference} ·{" "}
                  {t._count?.tests ?? 0} tests
                </div>
                <div className="mt-1 text-xs text-muted">
                  Limits: {t.maxRequestsPerSecond} rps / {t.maxConcurrency} conc /{" "}
                  {t.maxDurationSeconds}s
                </div>
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditingId(t.id);
                      setForm({
                        name: t.name,
                        hostname: t.hostname,
                        protocol: t.protocol,
                        port: t.port,
                        owner: t.owner,
                        authorizationReference: t.authorizationReference,
                        notes: t.notes ?? "",
                        maxRequestsPerSecond: t.maxRequestsPerSecond,
                        maxConcurrency: t.maxConcurrency,
                        maxDurationSeconds: t.maxDurationSeconds,
                      });
                    }}
                  >
                    Edit
                  </Button>
                  {t.authorizationStatus !== "APPROVED" && (
                    <Button
                      variant="primary"
                      onClick={() => setPending({ id: t.id, status: "APPROVED" })}
                    >
                      Approve
                    </Button>
                  )}
                  {t.authorizationStatus === "APPROVED" && (
                    <Button
                      onClick={() => setPending({ id: t.id, status: "SUSPENDED" })}
                    >
                      Suspend
                    </Button>
                  )}
                  {t.authorizationStatus !== "REVOKED" && (
                    <Button
                      variant="danger"
                      onClick={() => setPending({ id: t.id, status: "REVOKED" })}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!pending}
        danger={pending?.status !== "APPROVED"}
        title={`Set target to ${pending?.status}?`}
        confirmLabel={`Set ${pending?.status}`}
        requireTyped={pending?.status === "APPROVED" ? "APPROVE" : undefined}
        description={
          pending?.status === "APPROVED"
            ? "Approving authorizes load tests against this target. Confirm you have verified written authorization for this host."
            : "Any running or pending tests for this target will be signalled to stop."
        }
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (pending) await setStatus(pending.id, pending.status);
        }}
      />
    </div>
  );
}
