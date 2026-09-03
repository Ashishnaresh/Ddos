import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-5xl font-bold tabular-nums text-brand">404</div>
      <h1 className="text-lg font-semibold">This page could not be found</h1>
      <p className="max-w-sm text-sm text-muted">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/dashboard"
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          Go to dashboard
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
