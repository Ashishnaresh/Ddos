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
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(28800),

  MAX_GLOBAL_RPS: z.coerce.number().int().positive().default(2000),
  MAX_GLOBAL_CONCURRENCY: z.coerce.number().int().positive().default(500),
  MAX_TEST_DURATION: z.coerce.number().int().positive().default(300),
  MAX_PAYLOAD_BYTES: z.coerce.number().int().nonnegative().default(65536),
  MAX_CONCURRENT_TESTS: z.coerce.number().int().positive().default(5),

  TRUSTED_PROXY_MODE: z.enum(["none", "single", "list"]).default("none"),
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
