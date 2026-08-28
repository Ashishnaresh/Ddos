"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/clientApi";
import { Alert, Button, Field, Input } from "@/components/ui";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", displayName: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/register", { json: form });
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">Create account</h1>
        <p className="mt-1 text-sm text-muted">
          New accounts start as <strong>VIEWER</strong>. An administrator must
          grant test-execution rights.
        </p>
        <form onSubmit={submit} className="mt-5 space-y-3">
          {error && <Alert>{error}</Alert>}
          <Field label="Display name">
            <Input required value={form.displayName} onChange={set("displayName")} />
          </Field>
          <Field label="Email">
            <Input type="email" required value={form.email} onChange={set("email")} />
          </Field>
          <Field label="Password" hint="Min 12 chars, upper + lower + digit">
            <Input
              type="password"
              autoComplete="new-password"
              required
              value={form.password}
              onChange={set("password")}
            />
          </Field>
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-muted">
          Have an account?{" "}
          <Link href="/login" className="text-brand hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
