import { defineHandler, json } from "@/lib/apiHandler";
import { clearSessionCookies } from "@/lib/cookies";
import { revokeSession, SESSION_COOKIE } from "@/lib/session";
import { tryWriteAudit } from "@/lib/audit";

export const runtime = "nodejs";

export const POST = defineHandler({ auth: "optional" }, async ({ req, user, ip }) => {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  await revokeSession(token);
  if (user) {
    await tryWriteAudit({
      eventType: "LOGOUT",
      userId: user.id,
      observedIp: ip,
      result: "success",
    });
  }
  return clearSessionCookies(json({ ok: true }));
});
