"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/clientApi";
import { Button } from "./ui";
import { ConfirmDialog } from "./ConfirmDialog";

interface StopState {
  state: { active: boolean; reason?: string | null };
  activeTests: number;
}

export function EmergencyStopButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<StopState | null>(null);

  async function refresh() {
    try {
      setStatus(await api<StopState>("/api/admin/emergency-stop"));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  const active = status?.state.active;

  return (
    <>
      <Button
        variant="danger"
        className="w-full"
        onClick={() => setOpen(true)}
      >
        {active ? "■ STOP ACTIVE" : "Emergency stop"}
      </Button>
      {typeof status?.activeTests === "number" && status.activeTests > 0 && (
        <p className="text-center text-xs text-muted">
          {status.activeTests} active test(s)
        </p>
      )}

      <ConfirmDialog
        open={open}
        danger
        title={active ? "Clear global emergency stop?" : "Trigger GLOBAL emergency stop?"}
        requireTyped={active ? undefined : "STOP ALL"}
        confirmLabel={active ? "Clear emergency stop" : "Stop everything"}
        description={
          active ? (
            <p>
              This will lift the global block and allow new tests to start again.
            </p>
          ) : (
            <p>
              This immediately signals <strong>every running test</strong> to abort,
              rejects all pending tests, and blocks new tests until an admin clears
              it. Use only for genuine emergencies.
            </p>
          )
        }
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          await api("/api/admin/emergency-stop", {
            json: active
              ? { scope: "all", clear: true, reason: "cleared from console" }
              : { scope: "all", reason: "Emergency stop from console" },
          });
          setOpen(false);
          await refresh();
          router.refresh();
        }}
      />
    </>
  );
}
