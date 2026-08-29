import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/currentUser";
import { env } from "@/lib/env";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const current = await getCurrentUser();
  if (!current) redirect("/login");

  return (
    <AppShell
      user={{
        displayName: current.user.displayName,
        email: current.user.email,
        role: current.user.role,
      }}
      permissions={current.permissions}
      session={{
        idleSeconds: env.SESSION_IDLE_TIMEOUT_SECONDS,
        tabHideGraceSeconds: env.SESSION_TAB_HIDE_GRACE_SECONDS,
      }}
    >
      {children}
    </AppShell>
  );
}
