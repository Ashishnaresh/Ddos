// Runs before any test module is imported. Establishes deterministic safety
// ceilings so clamping assertions are stable regardless of the local .env.
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-secret-value-at-least-16-chars-long";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://loadtester:loadtester@localhost:5432/loadtester_test?schema=public";
process.env.MAX_GLOBAL_RPS = "1000";
process.env.MAX_GLOBAL_CONCURRENCY = "200";
process.env.MAX_TEST_DURATION = "60";
process.env.MAX_PAYLOAD_BYTES = "4096";
process.env.MAX_CONCURRENT_TESTS = "3";
process.env.TRUSTED_PROXY_MODE = process.env.TRUSTED_PROXY_MODE ?? "none";
process.env.APP_URL = "http://localhost:3000";
