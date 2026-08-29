"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/clientApi";
import { Alert, Button, Field, Input } from "@/components/ui";
import { PasswordChecklist, passwordValid } from "@/components/PasswordChecklist";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!passwordValid(pw)) {
      setError("Password does not meet the requirements below.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/auth/reset-password", { json: { token, newPassword: pw } });
      setDone(true);
      setTimeout(() => router.replace("/login"), 2500);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">Choose a new password</h1>
        {!token && (
          <Alert kind="error">
            Missing reset token. Use the link from your email.
          </Alert>
        )}
        {done ? (
          <Alert kind="success">
            Password updated. Redirecting to sign in…
          </Alert>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-3">
            {error && <Alert>{error}</Alert>}
            <Field label="New password">
              <Input
                type="password"
                autoComplete="new-password"
                required
                value={pw}
                onChange={(e) => setPw(e.target.value)}
              />
            </Field>
            <PasswordChecklist value={pw} />
            <Field label="Confirm new password">
              <Input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={busy || !token}
            >
              {busy ? "Updating…" : "Update password"}
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-xs text-muted">
          <Link href="/login" className="text-brand hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
