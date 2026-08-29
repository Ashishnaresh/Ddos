import { ApiError, defineHandler, json } from "@/lib/apiHandler";
import { rateLimit } from "@/lib/rateLimit";
import { forgotPasswordSchema } from "@/lib/schemas";
import { requestPasswordReset } from "@/lib/passwordReset";

export const runtime = "nodejs";

export const POST = defineHandler(
  {
    auth: "none",
    csrf: false,
    bodySchema: forgotPasswordSchema,
    maxBodyBytes: 4 * 1024,
  },
  async ({ body, ip }) => {
    const byIp = rateLimit(`forgot:ip:${ip}`, 5, 60 * 60 * 1000);
    const byEmail = rateLimit(`forgot:${body.email.toLowerCase()}`, 3, 60 * 60 * 1000);
    if (!byIp.ok || !byEmail.ok) {
      throw new ApiError(429, "RATE_LIMITED", "Too many requests. Try again later.");
    }
    await requestPasswordReset(body.email, ip);
    // Always the same response - never reveal whether the address exists.
    return json({
      ok: true,
      message:
        "If that email matches an account, a reset link has been sent. It is valid for a short time.",
    });
  },
);
