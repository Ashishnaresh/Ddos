"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/clientApi";

interface Props {
  idleSeconds: number;
  tabHideGraceSeconds: number;
}

/**
 * Client-side session enforcement:
 *  - signs out shortly after the app loses focus — switching tab, switching to
 *    another window, or minimizing (configurable grace period)
 *  - signs out after a period with no interaction (mirrors the server idle
 *    timeout so the redirect is immediate)
 *
 * The server independently enforces the same idle window, so a tampered client
 * gains nothing by disabling this.
 */
export function SessionGuard({ idleSeconds, tabHideGraceSeconds }: Props) {
  const doneRef = useRef(false);

  useEffect(() => {
    let awayTimer: ReturnType<typeof setTimeout> | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const signOut = (reason: "inactive" | "away") => {
      if (doneRef.current) return;
      doneRef.current = true;
      api("/api/auth/logout", { method: "POST" }).finally(() => {
        window.location.replace(`/login?reason=${reason}`);
      });
    };

    const resetIdle = () => {
      if (doneRef.current) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => signOut("inactive"), idleSeconds * 1000);
    };

    const leftApp = () => {
      if (doneRef.current || awayTimer) return;
      awayTimer = setTimeout(() => signOut("away"), tabHideGraceSeconds * 1000);
    };
    const backInApp = () => {
      if (awayTimer) {
        clearTimeout(awayTimer);
        awayTimer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") leftApp();
      else backInApp();
    };

    const activity = [
      "mousedown",
      "keydown",
      "pointerdown",
      "scroll",
      "touchstart",
    ];
    activity.forEach((e) =>
      window.addEventListener(e, resetIdle, { passive: true }),
    );
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", leftApp);
    window.addEventListener("focus", backInApp);
    resetIdle();

    return () => {
      if (awayTimer) clearTimeout(awayTimer);
      if (idleTimer) clearTimeout(idleTimer);
      activity.forEach((e) => window.removeEventListener(e, resetIdle));
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", leftApp);
      window.removeEventListener("focus", backInApp);
    };
  }, [idleSeconds, tabHideGraceSeconds]);

  return null;
}
