"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { Permission } from "@/lib/rbac";
import { api } from "@/lib/clientApi";
import { Badge, Button } from "./ui";
import { clsx } from "./clsx";
import { EmergencyStopButton } from "./EmergencyStopButton";

interface Props {
  user: { displayName: string; email: string; role: string };
  permissions: Permission[];
  children: React.ReactNode;
}

const NAV: { href: string; label: string; perm?: Permission }[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/tests", label: "Tests" },
  { href: "/tests/new", label: "New test", perm: "tests:start" },
  { href: "/targets", label: "Targets" },
  { href: "/audit", label: "Audit log", perm: "audit:view" },
  { href: "/admin", label: "Administration", perm: "users:manage" },
];

export function AppShell({ user, permissions, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const nav = NAV.filter((n) => !n.perm || permissions.includes(n.perm));

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 w-60 transform border-r border-border bg-surface p-4 transition-transform md:static md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-6 px-2">
          <div className="text-sm font-semibold">Authorized</div>
          <div className="text-sm font-semibold text-brand">Load Tester</div>
        </div>
        <nav className="space-y-1">
          {nav.map((n) => {
            const active =
              pathname === n.href ||
              (n.href !== "/dashboard" && pathname.startsWith(n.href) && n.href !== "/tests/new");
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className={clsx(
                  "block rounded-lg px-3 py-2 text-sm",
                  active
                    ? "bg-brand/10 font-medium text-brand"
                    : "text-muted hover:bg-bg hover:text-fg",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="absolute inset-x-4 bottom-4 space-y-3">
          {permissions.includes("emergency:stop") && <EmergencyStopButton />}
          <div className="card p-3">
            <div className="truncate text-xs font-medium text-fg">
              {user.displayName}
            </div>
            <div className="truncate text-xs text-muted">{user.email}</div>
            <div className="mt-1.5 flex items-center justify-between">
              <Badge>{user.role}</Badge>
              <button
                onClick={logout}
                className="text-xs text-muted hover:text-fg hover:underline"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3 md:hidden">
          <Button variant="ghost" onClick={() => setOpen((o) => !o)}>
            Menu
          </Button>
          <span className="text-sm font-semibold">Load Tester</span>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
