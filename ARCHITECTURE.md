# Architecture

## Components

| # | Component | Location | Responsibility |
|---|---|---|---|
| 1 | Web Dashboard | `src/app/(app)/**` | Authenticated React UI: dashboard, tests, targets, audit, admin. |
| 2 | Authentication Service | `src/lib/auth.ts`, `src/lib/session.ts`, `src/lib/password.ts` | Registration, login, scrypt hashing, sessions, brute-force lockout. |
| 3 | Authorization Service | `src/lib/rbac.ts`, `src/lib/safety.ts` | Role→permission matrix; per-request permission checks; `runPreflight()`. |
| 4 | Test Controller | `src/app/api/tests/**`, `src/lib/testRepo.ts` | Test creation, guarded lifecycle transitions, stop endpoint. |
| 5 | Load-Test Worker | `worker/index.ts` | Isolated process: claims `AUTHORIZED` tests, runs the engine, finalizes. |
| 6 | Target Allowlist | `AuthorizedTarget` model, `src/app/api/targets/**` | Explicit list of approved targets with per-target ceilings. |
| 7 | Rate Limiter | `src/lib/rateLimit.ts`, `src/lib/safety.ts` | Auth-endpoint rate limiting; per-target + global rate/concurrency clamps. |
| 8 | Telemetry Collector | `worker/index.ts` → `TestMetric`, `src/app/api/tests/[id]/stream` | Metric buckets persisted by the worker; SSE fan-out to the UI. |
| 9 | Audit Logger | `src/lib/audit.ts`, `AuditLog` model | Append-only event log. |
| 10 | Database | `prisma/schema.prisma`, PostgreSQL | Source of truth and the coordination channel between web and worker. |
| 11 | Real-Time Dashboard | `src/app/(app)/tests/[id]/page.tsx`, `src/components/Charts.tsx` | Live charts from the SSE stream. |
| 12 | Emergency Stop Controller | `src/app/api/admin/emergency-stop`, `EmergencyStopState` model | Per-test + global kill switch. |

## Why web and worker are separate processes

The load-generation code never runs inside a request handler. The web tier's job
is to decide **whether** a test may run (auth, RBAC, allowlist, clamping,
audit) and to record an `AUTHORIZED` `Test` row. The worker's job is to **run**
what was already authorized. The worker:

- has no inbound network surface,
- shares only pure library code (`src/lib/*`) with the web app — never a runtime,
- re-verifies authorization at execution time (fail-closed) in case a target was
  revoked in the gap between authorization and execution,
- is the only place that performs the `RUNNING → COMPLETED/ABORTED` transitions.

## Test lifecycle

```
CREATED ─► AUTHORIZING ─► AUTHORIZED ─► STARTING ─► RUNNING ─► STOPPING ─► COMPLETED
   │            │              │            │           │                    
   └── REJECTED ┴── REJECTED ──┴─ ABORTED ──┴─ FAILED / ABORTED ─────────────
```

`src/lib/lifecycle.ts` defines the allowed transitions. `src/lib/testRepo.ts`
enforces them twice: once against the in-memory state machine and once with a
conditional `UPDATE ... WHERE status = :expectedFrom`, so a check-then-act race
cannot move a test into an illegal state (e.g. `REJECTED → RUNNING`).

## Request flow: starting a test

1. `POST /api/tests` — `defineHandler` resolves the session, enforces
   same-origin + CSRF, checks the `tests:start` permission, validates the body
   with Zod.
2. Audit `TEST_REQUESTED`.
3. Create the `Test` row as `CREATED` (so even a rejection appears in history).
4. `CREATED → AUTHORIZING`.
5. `runPreflight()`:
   1. `assertServicesHealthy()` — DB reachable, a write transaction succeeds, no
      global emergency stop. **Fail-closed**: any failure throws.
   2. `authorizeUserForTestStart()` — active account, `ADMIN`/`OPERATOR` role.
   3. `assertGlobalCapacity()` — under `MAX_CONCURRENT_TESTS`.
   4. `loadAndValidateTarget()` — target exists and is `APPROVED`.
   5. `resolveEffectiveConfig()` — clamp rate/concurrency/duration to
      `min(target, global)`, resolve the path to an absolute URL **locked to the
      target origin**, reject forbidden headers, enforce the payload cap.
6. If anything was clamped, audit `SAFETY_LIMIT_TRIGGERED`.
7. Persist the effective config; `AUTHORIZING → AUTHORIZED`; audit
   `TEST_AUTHORIZED`.
8. The worker claims the row atomically (`UPDATE ... WHERE status='AUTHORIZED'
   AND workerId IS NULL`), re-verifies, transitions to `RUNNING`, and runs the
   engine.

## Load engine

`src/lib/engine.ts`. Token-bucket pacing releases `requestsPerSecond` permits per
second in 50 ms sub-intervals; the concurrency ceiling is a hard gate on
in-flight requests. Each request has its own timeout `AbortController`. On stop
or duration expiry the engine drains in-flight requests for up to one timeout
window, then aborts the rest. Metric buckets are emitted on `flushIntervalMs`
and persisted by the worker as `TestMetric` rows.

## Telemetry

The worker writes `TestMetric` rows. `GET /api/tests/[id]/stream` polls those
rows once per second and pushes `metric` / `status` / `done` SSE events. If
metric persistence fails 5 times in a row the worker aborts the test
(fail-safe). `GET /api/tests/[id]/metrics` returns the same data for
non-streaming clients and historical view.

## Client IP derivation

`src/lib/ip.ts`. The browser cannot influence the recorded IP. Forwarding
headers are consulted only per the operator's `TRUSTED_PROXY_MODE`
(`none` / `single` / `list`). See SECURITY.md.
