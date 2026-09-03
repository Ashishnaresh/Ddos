"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Permission } from "@/lib/rbac";
import { api } from "@/lib/clientApi";
import { Badge } from "./ui";
import { clsx } from "./clsx";
import { EmergencyStopButton } from "./EmergencyStopButton";
import { SessionGuard } from "./SessionGuard";
import { ToastProvider } from "./Toast";

interface Props {
  user: { displayName: string; email: string; role: string };
  permissions: Permission[];
  session: { idleSeconds: number; tabHideGraceSeconds: number };
  children: React.ReactNode;
}

const NAV: { href: string; label: string; perm?: Permission }[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/tests", label: "Tests" },
  { href: "/tests/new", label: "New test", perm: "tests:start" },
  { href: "/targets", label: "Targets" },
  { href: "/audit", label: "Audit log", perm: "audit:view" },
  { href: "/admin", label: "Administration", perm: "users:manage" },
  { href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === href;
  if (href === "/tests/new") return pathname === href;
  if (href === "/tests") return pathname === "/tests" || /^\/tests\/(?!new)/.test(pathname);
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppShell({ user, permissions, session, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const nav = NAV.filter((n) => !n.perm || permissions.includes(n.perm));
  const current = nav.find((n) => isActive(pathname, n.href))?.label ?? "Load Tester";

  // Close the drawer on route change and on Escape.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  return (
    <ToastProvider>
      <div className="flex min-h-screen">
        <SessionGuard
          idleSeconds={session.idleSeconds}
          tabHideGraceSeconds={session.tabHideGraceSeconds}
        />

        {open && (
          <div
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
        )}

        <aside
          className={clsx(
            "fixed inset-y-0 left-0 z-40 flex w-64 max-w-[85vw] transform flex-col border-r border-border bg-surface transition-transform md:static md:w-60 md:max-w-none md:translate-x-0",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <div>
              <div className="text-sm font-semibold">Authorized</div>
              <div className="text-sm font-semibold text-brand">Load Tester</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-muted hover:bg-bg hover:text-fg md:hidden"
              aria-label="Close menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={clsx(
                  "block rounded-lg px-3 py-2 text-sm",
                  isActive(pathname, n.href)
                    ? "bg-brand/10 font-medium text-brand"
                    : "text-muted hover:bg-bg hover:text-fg",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="space-y-3 border-t border-border p-3">
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

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur md:hidden">
            <button
              onClick={() => setOpen(true)}
              className="rounded-lg p-1.5 text-fg hover:bg-surface"
              aria-label="Open menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
              </svg>
            </button>
            <span className="truncate text-sm font-semibold">{current}</span>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 overflow-x-hidden p-4 md:p-8">
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
