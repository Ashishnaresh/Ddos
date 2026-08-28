import { ApiError, defineHandler, json } from "@/lib/apiHandler";
import { AuthError, authenticate } from "@/lib/auth";
import { createSession } from "@/lib/session";
import { setSessionCookies } from "@/lib/cookies";
import { rateLimit } from "@/lib/rateLimit";
import { loginSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export const POST = defineHandler(
  { auth: "none", bodySchema: loginSchema, csrf: false, maxBodyBytes: 8 * 1024 },
  async ({ body, ip, req }) => {
    const byIp = rateLimit(`login:ip:${ip}`, 20, 15 * 60 * 1000);
    const byUser = rateLimit(`login:user:${body.email.toLowerCase()}`, 10, 15 * 60 * 1000);
    if (!byIp.ok || !byUser.ok) {
      throw new ApiError(
        429,
        "RATE_LIMITED",
        `Too many login attempts. Retry in ${Math.max(byIp.retryAfterSec, byUser.retryAfterSec)}s.`,
      );
    }
    try {
      const user = await authenticate({ ...body, ip });
      const s = await createSession(user.id, {
        ip,
        userAgent: req.headers.get("user-agent"),
      });
      const res = json({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
        },
      });
      return setSessionCookies(res, s);
    } catch (err) {
      if (err instanceof AuthError) {
        const status = err.code === "ACCOUNT_LOCKED" ? 423 : 401;
        throw new ApiError(status, err.code, err.message);
      }
      throw err;
    }
  },
);
