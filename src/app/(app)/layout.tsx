import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/currentUser";
import { AppShell } from "@/components/AppShell";

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
    >
      {children}
    </AppShell>
  );
}
