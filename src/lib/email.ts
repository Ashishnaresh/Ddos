import { env } from "./env";
import { logger } from "./logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type EmailResult = { delivered: boolean; via: "smtp" | "resend" | "none" };

/**
 * Transactional email. Tries SMTP first (SMTP_URL), then Resend
 * (RESEND_API_KEY), then falls back to logging the message so a self-hosted
 * operator can still retrieve a reset link. `npm run reset-password` and the
 * admin "Reset password" button are the no-email recovery paths.
 */
export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  if (env.SMTP_URL) {
    const ok = await sendViaSmtp(msg);
    if (ok) return { delivered: true, via: "smtp" };
  }
  if (env.RESEND_API_KEY) {
    const ok = await sendViaResend(msg);
    if (ok) return { delivered: true, via: "resend" };
  }

  logger.info("email not delivered (no working provider); message follows", {
    to: msg.to,
    subject: msg.subject,
    body: msg.text,
  });
  return { delivered: false, via: "none" };
}

async function sendViaSmtp(msg: EmailMessage): Promise<boolean> {
  try {
    // Imported lazily so the client bundle / edge never pulls nodemailer.
    const nodemailer = (await import("nodemailer")).default;
    const transport = nodemailer.createTransport(env.SMTP_URL);
    await transport.sendMail({
      from: env.EMAIL_FROM,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return true;
  } catch (err) {
    logger.error("smtp send failed", { err: (err as Error).message });
    return false;
  }
}

async function sendViaResend(msg: EmailMessage): Promise<boolean> {
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
      logger.error("resend send failed", {
        status: res.status,
        body: await res.text().catch(() => ""),
      });
      return false;
    }
    return true;
  } catch (err) {
    logger.error("resend send error", { err: (err as Error).message });
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
