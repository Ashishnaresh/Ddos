"use client";

import { clsx } from "./clsx";

export function Card({
  children,
  className,
  title,
  actions,
}: {
  children: React.ReactNode;
  className?: string;
  title?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className={clsx("card p-5", className)}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold text-fg">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-fg">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

const BADGE_STYLES: Record<string, string> = {
  APPROVED: "bg-emerald-500/15 text-emerald-500",
  PENDING: "bg-amber-500/15 text-amber-500",
  SUSPENDED: "bg-orange-500/15 text-orange-500",
  REVOKED: "bg-red-500/15 text-red-500",
  RUNNING: "bg-blue-500/15 text-blue-500",
  STARTING: "bg-blue-500/15 text-blue-500",
  AUTHORIZING: "bg-indigo-500/15 text-indigo-500",
  AUTHORIZED: "bg-indigo-500/15 text-indigo-500",
  STOPPING: "bg-amber-500/15 text-amber-500",
  COMPLETED: "bg-emerald-500/15 text-emerald-500",
  ABORTED: "bg-orange-500/15 text-orange-500",
  FAILED: "bg-red-500/15 text-red-500",
  REJECTED: "bg-red-500/15 text-red-500",
  CREATED: "bg-gray-500/15 text-gray-400",
  ADMIN: "bg-purple-500/15 text-purple-500",
  OPERATOR: "bg-blue-500/15 text-blue-500",
  VIEWER: "bg-gray-500/15 text-gray-400",
};

export function Badge({ children }: { children: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        BADGE_STYLES[children] ?? "bg-gray-500/15 text-gray-400",
      )}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  variant = "default",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost";
}) {
  const styles = {
    default: "bg-surface border border-border hover:bg-bg text-fg",
    primary: "bg-brand text-white hover:opacity-90",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "hover:bg-surface text-muted hover:text-fg",
  }[variant];
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        styles,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-brand",
        props.className,
      )}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={clsx(
        "w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-brand",
        props.className,
      )}
    />
  );
}

export function Alert({
  kind = "error",
  children,
}: {
  kind?: "error" | "info" | "success" | "warn";
  children: React.ReactNode;
}) {
  const styles = {
    error: "bg-red-500/10 text-red-500 border-red-500/30",
    info: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    success: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
    warn: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  }[kind];
  return (
    <div className={clsx("rounded-lg border px-3 py-2 text-sm", styles)}>
      {children}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
      <p className="text-sm font-medium text-fg">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-brand" />
  );
}
