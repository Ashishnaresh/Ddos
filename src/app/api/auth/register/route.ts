import { ApiError, defineHandler, json } from "@/lib/apiHandler";
import { AuthError, registerUser } from "@/lib/auth";
import { createSession } from "@/lib/session";
import { setSessionCookies } from "@/lib/cookies";
import { rateLimit } from "@/lib/rateLimit";
import { registerSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export const POST = defineHandler(
  { auth: "none", bodySchema: registerSchema, csrf: false, maxBodyBytes: 8 * 1024 },
  async ({ body, ip, req }) => {
    const rl = rateLimit(`register:${ip}`, 5, 60 * 60 * 1000);
    if (!rl.ok) {
      throw new ApiError(429, "RATE_LIMITED", "Too many attempts. Try later.");
    }
    try {
      const user = await registerUser({ ...body, ip });
      const s = await createSession(user.id, {
        ip,
        userAgent: req.headers.get("user-agent"),
      });
      const res = json(
        {
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            role: user.role,
          },
        },
        201,
      );
      return setSessionCookies(res, s);
    } catch (err) {
      if (err instanceof AuthError) {
        throw new ApiError(400, err.code, err.message);
      }
      throw err;
    }
  },
);
