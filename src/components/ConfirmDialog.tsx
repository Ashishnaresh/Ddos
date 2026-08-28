"use client";

import { useState } from "react";
import { Button, Input } from "./ui";

interface Props {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** If set, the user must type this exact string to enable confirm. */
  requireTyped?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  danger,
  requireTyped,
  onConfirm,
  onCancel,
}: Props) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const disabled = busy || (requireTyped ? typed !== requireTyped : false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="card w-full max-w-md p-5">
        <h3 className="text-base font-semibold text-fg">{title}</h3>
        {description && (
          <div className="mt-2 text-sm text-muted">{description}</div>
        )}
        {requireTyped && (
          <div className="mt-3">
            <p className="mb-1 text-xs text-muted">
              Type <span className="font-mono text-fg">{requireTyped}</span> to confirm
            </p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={disabled}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
                setTyped("");
              }
            }}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
