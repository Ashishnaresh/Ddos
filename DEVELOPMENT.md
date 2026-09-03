# Development

## Prerequisites

- Node.js ≥ 20 (22 recommended)
- PostgreSQL 14+ (local install or the Docker Compose `postgres` service)
- Docker + Docker Compose (optional, for the full stack)

## First-time setup

```bash
npm install
cp .env.example .env
# set SESSION_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# set DATABASE_URL to a reachable Postgres

npm run prisma:migrate     # creates the schema + a migration
npm run db:seed             # dev accounts + one APPROVED local echo target
```

## Running

```bash
npm run dev        # Next.js dev server on :3000
npm run worker     # load-test worker (tsx watch) — separate terminal
```

For a target to test against locally without Docker, run any local HTTP server
you control and add it as a target in the UI (Admin → Targets → Add → Approve).
With Docker Compose the `echo` service is pre-seeded and approved.

## Project layout

```
prisma/schema.prisma      data model
src/lib/                   shared library code (used by web AND worker)
  env.ts                   validated env + safety ceilings
  safety.ts                the central server-side safety policy (runPreflight)
  lifecycle.ts             test state machine
  testRepo.ts              guarded DB state transitions
  engine.ts                controlled HTTP load generator
  metrics.ts               latency percentile / aggregation helpers
  session.ts auth.ts       authentication + sessions + CSRF
  apiHandler.ts            route wrapper: auth, RBAC, CSRF, validation, errors
  ip.ts                    server-side client IP derivation
  audit.ts                 append-only audit writes
src/app/api/               REST + SSE endpoints
src/app/(app)/             authenticated dashboard pages
src/components/             UI components
worker/index.ts            isolated worker process
tests/                     Vitest unit + integration tests
e2e/                       Playwright specs
```

## Common tasks

| Task | Command |
|---|---|
| Type-check | `npm run typecheck` |
| Lint | `npm run lint` |
| Unit tests | `npm test` |
| Integration tests | `RUN_DB_TESTS=1 DATABASE_URL=…_test npm test` |
| E2E | `npm run build && npm run db:seed && npm run test:e2e` |
| New migration | `npm run prisma:migrate -- --name your_change` |
| Prisma Studio | `npm run prisma:studio` |
| Full stack | `docker compose up --build` |

## Adding an API endpoint

Use `defineHandler` from `src/lib/apiHandler.ts`. It gives you auth resolution,
RBAC (`permission` / `roles`), CSRF + same-origin enforcement for mutations,
body-size limits, Zod validation, and uniform error mapping. Never read
`process.env` for safety ceilings directly — go through `src/lib/env.ts`.

Any endpoint that can start load **must** call `runPreflight()`. Do not add a
second path.

## Testing philosophy

`tests/` includes deliberate **negative** tests: attempts to exceed rate /
duration / concurrency limits, escape the target origin, spoof identity headers,
start tests as a `VIEWER`, resurrect a `REJECTED` test, and run while the
emergency stop is active. All of them must fail. Keep it that way.

## Secrets

- All secrets come from environment variables — see `.env.example`. Never commit
  a populated `.env`; `.env*` (except `.env.example`) and key/cert files are
  git-ignored.
- Every push and PR is scanned by the `gitleaks` GitHub Actions workflow.
- Optional local guard: `git config core.hooksPath .githooks` enables a
  pre-commit `gitleaks` scan (install `gitleaks` first: `brew install gitleaks`).
- If a secret is ever exposed, rotate it at the provider immediately — see
  `SECURITY.md`.

## Conventions

- TypeScript strict mode.
- Server-only modules (`db`, `engine`, `safety`, `session`) must never be
  imported into a client component.
- Prefer editing `src/lib/*` over duplicating logic in a route or the worker.
- Commits from this repo are authored `Ashish Naulach`
  (`git config user.name` / `user.email` are set locally). Coding assistants are
  tools, not the author — do not change the commit identity.
