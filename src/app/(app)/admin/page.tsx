"use client";

import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/clientApi";
import { Alert, Badge, Button, Card, Select } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  lockedUntil: string | null;
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [limits, setLimits] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<AdminUser | null>(null);
  const [resetResult, setResetResult] = useState<{ email: string; password: string } | null>(
    null,
  );

  async function load() {
    try {
      const [u, c] = await Promise.all([
        api<{ users: AdminUser[] }>("/api/admin/users"),
        api<{ limits: Record<string, unknown> }>("/api/admin/config"),
      ]);
      setUsers(u.users);
      setLimits(c.limits);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Load failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function update(id: string, patch: Partial<Pick<AdminUser, "role" | "isActive">>) {
    setError(null);
    try {
      await api(`/api/admin/users/${id}`, { method: "PATCH", json: patch });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Update failed");
    }
  }

  async function resetPassword(u: AdminUser) {
    setError(null);
    try {
      const r = await api<{ password: string; user: { email: string } }>(
        `/api/admin/users/${u.id}/reset-password`,
        { method: "POST", json: {} },
      );
      setResetFor(null);
      setResetResult({ email: r.user.email, password: r.password });
      await load();
    } catch (err) {
      setResetFor(null);
      setError(err instanceof ApiClientError ? err.message : "Reset failed");
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Administration</h1>
      {error && <Alert>{error}</Alert>}

      <Card title="Server-side safety limits (read-only)">
        {limits ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
            {Object.entries(limits).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-border/50 py-1">
                <dt className="text-muted">{k}</dt>
                <dd className="font-mono">{String(v)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
        <p className="mt-3 text-xs text-muted">
          Configured through environment variables only. Restart the app and
          worker to change them.
        </p>
      </Card>

      <Card title="Users">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted">
              <tr>
                <th className="py-2 pr-4">User</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="py-2 pr-4">
                    <div>{u.displayName}</div>
                    <div className="text-xs text-muted">{u.email}</div>
                  </td>
                  <td className="py-2 pr-4">
                    <Select
                      value={u.role}
                      onChange={(e) => update(u.id, { role: e.target.value as AdminUser["role"] })}
                      className="w-32"
                    >
                      <option>ADMIN</option>
                      <option>OPERATOR</option>
                      <option>VIEWER</option>
                    </Select>
                  </td>
                  <td className="py-2 pr-4">
                    <Badge>{u.isActive ? "ACTIVE" : "DISABLED"}</Badge>
                    {u.lockedUntil && new Date(u.lockedUntil) > new Date() && (
                      <span className="ml-1 text-xs text-amber-500">locked</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant={u.isActive ? "danger" : "primary"}
                        onClick={() => update(u.id, { isActive: !u.isActive })}
                      >
                        {u.isActive ? "Disable" : "Enable"}
                      </Button>
                      <Button onClick={() => setResetFor(u)}>Reset password</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">
          Changing a role or disabling a user immediately revokes their active
          sessions. The last active admin cannot be demoted or disabled.
        </p>
      </Card>

      <ConfirmDialog
        open={!!resetFor}
        danger
        title={`Reset password for ${resetFor?.email}?`}
        confirmLabel="Generate new password"
        description="A new password is generated and shown once. The user's current sessions are revoked and any lockout is cleared."
        onCancel={() => setResetFor(null)}
        onConfirm={async () => {
          if (resetFor) await resetPassword(resetFor);
        }}
      />

      {resetResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-5">
            <h3 className="text-base font-semibold">New password</h3>
            <p className="mt-1 text-sm text-muted">
              For <span className="font-medium text-fg">{resetResult.email}</span>.
              Copy it now — it is not shown again.
            </p>
            <pre className="mt-3 select-all rounded-lg border border-border bg-bg px-3 py-2 text-sm">
              {resetResult.password}
            </pre>
            <div className="mt-4 flex justify-end">
              <Button variant="primary" onClick={() => setResetResult(null)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
