# Authorized Load Tester

A controlled, application-layer HTTP **load / DDoS-simulation testing platform**
for infrastructure that **you own or have explicit written authorization to
test**. It is built for capacity planning, resilience testing, and
authorized red-team performance work — not for attacking third parties.

> ⚠️ **Authorized use only.** Every test requires an authenticated user, a
> server-side authorization check, and a target that an administrator has
> explicitly moved to `APPROVED` with a recorded authorization reference. There
> is no anonymous mode and no "test any host" mode. All activity is audited with
> the acting user's identity and the server-observed client IP.

## What it does

- **RBAC** with `ADMIN` / `OPERATOR` / `VIEWER` roles.
- **Authorized target allowlist** — tests only run against `APPROVED` targets,
  each with its own rate / concurrency / duration ceilings.
- **Server-side safety policy** — a single `runPreflight()` gate that every
  test-start path funnels through. Client-supplied rate, concurrency, duration,
  payload size, headers, and target authorization are all re-validated and
  clamped server-side. Hard global ceilings come from environment variables and
  cannot be exceeded from the frontend.
- **Isolated load-generation worker** — a separate process that only ever acts
  on already-authorized `Test` rows. It never accepts inbound HTTP.
- **Controlled HTTP load engine** — fixed request rate, hard concurrency cap,
  fixed duration, per-request timeout, graceful drain, `AbortController`
  cancellation. Nothing below the HTTP layer; no spoofing, reflection,
  amplification, or protection-bypass techniques.
- **Real-time telemetry** — SSE stream of RPS, latency percentiles (p50/p95/p99),
  status-code distribution, error and timeout counts.
- **Emergency stop** — per-test stop and a global kill switch that aborts every
  running test and blocks new ones until an admin clears it.
- **Immutable-style audit log** — append-only, admin-only, with configurable
  retention.
- **Fail-closed** — if the database / telemetry / safety layer is unavailable, no
  new test starts. An unknown authorization state is never treated as
  authorized.

## Architecture

```
Browser ──► Next.js web app (auth, RBAC, safety preflight, audit, dashboard)
                   │  writes AUTHORIZED Test rows + audit
                   ▼
             PostgreSQL  ◄──────────────┐
                   ▲                    │ claims AUTHORIZED tests,
   SSE telemetry   │  metrics + status  │ streams metrics, honors stop
                   │                    │
             Load-Test Worker (isolated process) ──► HTTP requests ──► APPROVED target
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for component detail and
[SECURITY.md](./SECURITY.md) for the threat model and control list.

## Tech stack

Next.js 14 (App Router) · React 18 · TypeScript · Tailwind CSS · Node.js worker ·
PostgreSQL · Prisma · Vitest · Playwright · Docker Compose.

## Quick start (Docker)

```bash
cp .env.example .env
# edit .env — at minimum set a strong SESSION_SECRET:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

docker compose up --build
```

This starts Postgres, runs `prisma migrate deploy`, seeds dev accounts and one
local `APPROVED` echo target, then starts `web` (http://localhost:3000) and
`worker`.

Seeded dev accounts (development only — change/remove for any real deployment):

| Role     | Email                  | Password           |
|----------|------------------------|--------------------|
| ADMIN    | admin@example.com      | `AdminPass123!`    |
| OPERATOR | operator@example.com   | `OperatorPass123!` |
| VIEWER   | viewer@example.com     | `ViewerPass123!`   |

The **first account ever registered** on a fresh database automatically becomes
`ADMIN`; everyone else starts as `VIEWER` and must be promoted.

## Quick start (local, without Docker)

```bash
npm install
cp .env.example .env            # set SESSION_SECRET and a reachable DATABASE_URL

npm run prisma:migrate          # create the schema
npm run db:seed                 # optional dev data

npm run dev                     # web on :3000
npm run worker                  # worker (separate terminal)
```

## Database migrations

```bash
npm run prisma:migrate          # dev: create + apply a new migration
npm run prisma:deploy           # prod/CI: apply committed migrations
npm run prisma:studio           # inspect data
```

## Running tests

```bash
npm test                        # unit + engine tests (no database needed)

# Integration tests need a migrated test database:
createdb loadtester_test
DATABASE_URL=postgresql://loadtester:loadtester@localhost:5432/loadtester_test npm run prisma:deploy
RUN_DB_TESTS=1 DATABASE_URL=postgresql://loadtester:loadtester@localhost:5432/loadtester_test npm test

# End-to-end (needs a running, seeded app):
npm run build && npm run db:seed
npx playwright install --with-deps chromium
npm run test:e2e
```

## Production build

```bash
npm run build                   # prisma generate + next build
npm run start                   # serve the production build
```

## Configuration

All configuration is via environment variables — see
[.env.example](./.env.example). The safety-relevant ones:

| Variable | Meaning |
|---|---|
| `MAX_GLOBAL_RPS` | Absolute ceiling on requests/sec for any test. |
| `MAX_GLOBAL_CONCURRENCY` | Absolute ceiling on concurrency for any test. |
| `MAX_TEST_DURATION` | Absolute ceiling on test duration (seconds). |
| `MAX_PAYLOAD_BYTES` | Hard cap on request body size. |
| `MAX_CONCURRENT_TESTS` | Max tests running platform-wide at once. |
| `TRUSTED_PROXY_MODE` | `none` / `single` / `list` — how the client IP is derived. |
| `AUDIT_RETENTION_DAYS` | Audit log retention target. |

Per-target limits are always clamped down to these global values.

## What this project deliberately does NOT do

No IP spoofing, UDP reflection, DNS amplification, SYN floods, botnet
coordination, credential attacks, exploit delivery, CDN/WAF/rate-limit bypass,
stealth/evasion, identity hiding, persistence, or arbitrary third-party
targeting. Requests are ordinary `fetch()` calls that carry a static,
identifying `User-Agent`.
