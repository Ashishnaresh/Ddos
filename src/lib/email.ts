import { env } from "./env";
import { logger } from "./logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sends transactional email via Resend when RESEND_API_KEY is set.
 *
 * Fallback (no key): logs the message so a self-hosted operator can still
 * retrieve a password-reset link from the server logs. The CLI
 * `npm run reset-password` is the guaranteed, offline recovery path.
 */
export async function sendEmail(msg: EmailMessage): Promise<{ delivered: boolean }> {
  if (!env.RESEND_API_KEY) {
    logger.warn("email not configured; message not delivered", {
      to: msg.to,
      subject: msg.subject,
      body: msg.text,
    });
    return { delivered: false };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html ?? `<pre>${escapeHtml(msg.text)}</pre>`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.error("resend send failed", { status: res.status, body: await res.text() });
      return { delivered: false };
    }
    return { delivered: true };
  } catch (err) {
    logger.error("resend send error", { err: (err as Error).message });
    return { delivered: false };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
