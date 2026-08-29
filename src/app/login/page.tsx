"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/clientApi";
import { Alert, Button, Field, Input } from "@/components/ui";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

const REASONS: Record<string, string> = {
  away: "You were signed out because you left the app tab or window.",
  inactive: "You were signed out after a period of inactivity.",
  next: "Please sign in to continue.",
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const notice = REASONS[params.get("reason") ?? ""];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { json: { email, password } });
      router.replace(params.get("next") || "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">Authorized Load Tester</h1>
        <p className="mt-1 text-sm text-muted">Sign in to continue</p>
        {notice && (
          <div className="mt-3">
            <Alert kind="info">{notice}</Alert>
          </div>
        )}
        <form onSubmit={submit} className="mt-5 space-y-3">
          {error && <Alert>{error}</Alert>}
          <Field label="Email">
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <div className="mt-4 flex items-center justify-between text-xs text-muted">
          <Link href="/register" className="text-brand hover:underline">
            Create account
          </Link>
          <Link href="/forgot-password" className="text-brand hover:underline">
            Forgot password?
          </Link>
        </div>
      </div>
    </div>
  );
}
