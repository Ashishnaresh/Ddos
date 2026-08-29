"use client";

import { useState } from "react";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/clientApi";
import { Alert, Button, Field, Input } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ message: string }>("/api/auth/forgot-password", {
        json: { email },
      });
      setDone(r.message);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">Reset password</h1>
        <p className="mt-1 text-sm text-muted">
          Enter your account email and we&apos;ll send a reset link.
        </p>
        {done ? (
          <Alert kind="success">{done}</Alert>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-3">
            {error && <Alert>{error}</Alert>}
            <Field label="Email">
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
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
