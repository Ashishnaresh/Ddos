"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/clientApi";
import { Alert, Button, Field, Input } from "@/components/ui";

const RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: "At least 12 characters", test: (p) => p.length >= 12 },
  { label: "A lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "An uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "A digit", test: (p) => /[0-9]/.test(p) },
];

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", displayName: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  const checks = useMemo(
    () => RULES.map((r) => ({ ...r, ok: r.test(form.password) })),
    [form.password],
  );
  const pwValid = checks.every((c) => c.ok);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!pwValid) {
      setError("Password does not meet the requirements below.");
      return;
    }
    setBusy(true);
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
          <Field label="Password">
            <Input
              type="password"
              autoComplete="new-password"
              required
              value={form.password}
              onChange={set("password")}
              onBlur={() => setTouched(true)}
            />
          </Field>

          {(touched || form.password.length > 0) && (
            <ul className="space-y-1 text-xs">
              {checks.map((c) => (
                <li
                  key={c.label}
                  className={c.ok ? "text-emerald-500" : "text-muted"}
                >
                  {c.ok ? "✓" : "○"} {c.label}
                </li>
              ))}
            </ul>
          )}

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={busy || !pwValid}
          >
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
