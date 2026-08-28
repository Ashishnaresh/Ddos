"use client";

import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/clientApi";
import { Alert, Badge, Button, Card, Select } from "@/components/ui";

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
                    <Button
                      variant={u.isActive ? "danger" : "primary"}
                      onClick={() => update(u.id, { isActive: !u.isActive })}
                    >
                      {u.isActive ? "Disable" : "Enable"}
                    </Button>
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
    </div>
  );
}
