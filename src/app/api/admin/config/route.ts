import { defineHandler, json } from "@/lib/apiHandler";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/**
 * Read-only view of the server-side safety ceilings. These are configured via
 * environment variables and cannot be changed from the frontend - this endpoint
 * exists so admins can *see* the effective limits.
 */
export const GET = defineHandler(
  { auth: "required", permission: "safety:configure", roles: ["ADMIN"] },
  async () => {
    return json({
      limits: {
        MAX_GLOBAL_RPS: env.MAX_GLOBAL_RPS,
        MAX_GLOBAL_CONCURRENCY: env.MAX_GLOBAL_CONCURRENCY,
        MAX_TEST_DURATION: env.MAX_TEST_DURATION,
        MAX_PAYLOAD_BYTES: env.MAX_PAYLOAD_BYTES,
        MAX_CONCURRENT_TESTS: env.MAX_CONCURRENT_TESTS,
        SESSION_TTL_SECONDS: env.SESSION_TTL_SECONDS,
        TRUSTED_PROXY_MODE: env.TRUSTED_PROXY_MODE,
        AUDIT_RETENTION_DAYS: env.AUDIT_RETENTION_DAYS,
      },
      note:
        "These ceilings are set via environment variables and are enforced server-side. Per-target limits are clamped to these values.",
    });
  },
);
