"use client";

import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/clientApi";
import { Alert, Badge, Button, Card, Field, Input } from "@/components/ui";
import { PasswordChecklist, passwordValid } from "@/components/PasswordChecklist";
import { useToast } from "@/components/Toast";

interface Me {
  user: { email: string; displayName: string; role: string };
}

export default function SettingsPage() {
  const toast = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Me>("/api/auth/me").then(setMe).catch(() => undefined);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next !== confirm) {
      setMsg({ kind: "error", text: "New passwords do not match." });
      return;
    }
    if (!passwordValid(next)) {
      setMsg({ kind: "error", text: "New password does not meet the requirements." });
      return;
    }
    setBusy(true);
    try {
      await api("/api/auth/change-password", {
        json: { currentPassword: cur, newPassword: next },
      });
      const text = "Password changed. All other sessions were signed out.";
      setMsg({ kind: "success", text });
      toast.success(text);
      setCur("");
      setNext("");
      setConfirm("");
    } catch (err) {
      const text = err instanceof ApiClientError ? err.message : "Change failed";
      setMsg({ kind: "error", text });
      toast.error(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Card title="Account">
        {me ? (
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Name</dt>
              <dd>{me.user.displayName}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Email</dt>
              <dd>{me.user.email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Role</dt>
              <dd>
                <Badge>{me.user.role}</Badge>
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>

      <Card title="Change password">
        <form onSubmit={submit} className="space-y-3">
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <Field label="Current password">
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={cur}
              onChange={(e) => setCur(e.target.value)}
            />
          </Field>
          <Field label="New password">
            <Input
              type="password"
              autoComplete="new-password"
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
          <PasswordChecklist value={next} />
          <Field label="Confirm new password">
            <Input
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Changing…" : "Change password"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
