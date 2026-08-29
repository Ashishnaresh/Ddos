import { ApiError, defineHandler, json } from "@/lib/apiHandler";
import { rateLimit } from "@/lib/rateLimit";
import { resetPasswordSchema } from "@/lib/schemas";
import { completePasswordReset, ResetError } from "@/lib/passwordReset";

export const runtime = "nodejs";

export const POST = defineHandler(
  {
    auth: "none",
    csrf: false,
    bodySchema: resetPasswordSchema,
    maxBodyBytes: 4 * 1024,
  },
  async ({ body, ip }) => {
    const rl = rateLimit(`reset:ip:${ip}`, 10, 60 * 60 * 1000);
    if (!rl.ok) {
      throw new ApiError(429, "RATE_LIMITED", "Too many attempts. Try again later.");
    }
    try {
      await completePasswordReset(body.token, body.newPassword, ip);
      return json({ ok: true });
    } catch (err) {
      if (err instanceof ResetError) {
        throw new ApiError(
          err.code === "WEAK_PASSWORD" ? 400 : 410,
          err.code,
          err.message,
        );
      }
      throw err;
    }
  },
);
