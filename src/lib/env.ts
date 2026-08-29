import { z } from "zod";

/**
 * Centralized, validated environment access.
 *
 * Every safety-relevant ceiling lives here. Nothing in the codebase should read
 * `process.env` for these values directly - always go through `env` so the
 * clamping in `safety.ts` has a single source of truth.
 *
 * Validation is LAZY: it runs the first time `env` is read, not at import time,
 * so `next build` page-data collection (which imports server modules without a
 * populated environment) does not fail. At runtime the first access still
 * throws loudly on misconfiguration.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z
    .string()
    .min(16, "SESSION_SECRET must be at least 16 characters"),
  // Absolute maximum session lifetime (DB expiresAt), regardless of activity.
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(28800),
  // Session is invalidated after this long with no request from the client.
  SESSION_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(900),
  // Client grace period after a tab is hidden/backgrounded before it signs out.
  SESSION_TAB_HIDE_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(5),

  MAX_GLOBAL_RPS: z.coerce.number().int().positive().default(2000),
  MAX_GLOBAL_CONCURRENCY: z.coerce.number().int().positive().default(500),
  MAX_TEST_DURATION: z.coerce.number().int().positive().default(300),
  MAX_PAYLOAD_BYTES: z.coerce.number().int().nonnegative().default(65536),
  MAX_CONCURRENT_TESTS: z.coerce.number().int().positive().default(5),

  TRUSTED_PROXY_MODE: z
    .enum(["none", "single", "list", "vercel"])
    .default("none"),
  TRUSTED_PROXIES: z.string().default(""),

  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(365),

  WORKER_ID: z.string().default("worker-1"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  METRICS_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(1000),

  // Serverless (Vercel Cron) worker model.
  // CRON_SECRET is what Vercel Cron sends as `Authorization: Bearer <secret>`.
  CRON_SECRET: z.string().default(""),
  // Optional manual trigger secret for POST /api/worker/tick.
  WORKER_TICK_SECRET: z.string().default(""),
  // Wall-clock budget for a single serverless tick; keep below the function's
  // maxDuration for the deployment's plan (Hobby 60s, Pro 300s, ...).
  WORKER_TICK_BUDGET_SECONDS: z.coerce.number().int().positive().default(55),

  APP_URL: z.string().url().default("http://localhost:3000"),
  // Extra comma-separated origins accepted for CSRF same-origin checks, on top
  // of the request's own <scheme>://<host> and APP_URL. Usually unnecessary.
  EXTRA_ALLOWED_ORIGINS: z.string().default(""),

  // Email (password reset). Delivery order: SMTP_URL, then RESEND_API_KEY, then
  // "log only" fallback. `npm run reset-password` + the admin reset button are
  // the no-email recovery paths.
  //   SMTP_URL example (Gmail app password):
  //     smtp://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465
  SMTP_URL: z.string().default(""),
  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().default("Authorized Load Tester <onboarding@resend.dev>"),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

function load(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:");
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }
  cached = parsed.data;
  return cached;
}

export const env = new Proxy({} as Env, {
  get(_t, prop: string) {
    return load()[prop as keyof Env];
  },
}) as Env;

export function trustedProxyCidrs(): string[] {
  return load()
    .TRUSTED_PROXIES.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
