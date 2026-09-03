# Security & Safety

## Purpose and scope

This platform generates **application-layer HTTP load** against a small,
explicitly approved allowlist of targets, for authorized performance and
resilience testing. It is not a tool for attacking third-party infrastructure.

## Threat model

| Adversary | Goal | Mitigation |
|---|---|---|
| Authenticated operator | Test a host they are not authorized to test | Target allowlist; only `APPROVED` targets run; approval is an admin action with a recorded authorization reference; path is locked to the target origin. |
| Authenticated operator | Exceed safe load (huge RPS/duration/payload) | Server-side clamp in `resolveEffectiveConfig()` to `min(per-target, global-env)` ceilings; hard payload byte cap; platform-wide concurrent-test limit. |
| Malicious frontend / tampered client | Bypass checks by calling the API directly | All checks are server-side in `defineHandler` + `runPreflight`. There is no route that starts a test without them. Client values are treated as *requests*, never authority. |
| Malicious client | Forge the audited source IP | IP is derived server-side (`src/lib/ip.ts`); forwarding headers are honored only per operator-configured `TRUSTED_PROXY_MODE`. `X-Forwarded-For`, `X-Real-IP`, `Host`, etc. cannot be set as test headers. |
| Attacker with stolen session cookie | Reuse it indefinitely | Sessions are random 256-bit tokens stored **hashed**; server-side expiry; revoke on logout, role change, or account disable. |
| Credential-stuffing attacker | Brute force login | Per-IP + per-account in-process rate limits; DB-backed account lockout after 8 failures for 15 minutes; generic error messages; constant-ish work on unknown users. |
| CSRF | State-changing request from another origin | Double-submit CSRF token (`alt_csrf` cookie ↔ `x-csrf-token` header, compared to the session's stored secret) + strict `Origin`/`Referer` allowlist on every mutation. |
| Compromised dependency / infra outage | Run tests without a working audit trail | Fail-closed: `assertServicesHealthy()` requires a successful DB read *and* write transaction before any test starts; an error is never interpreted as authorization. |
| Runaway or misbehaving test | Sustained unwanted load | Automatic duration limit in the engine + an outer hard-timeout guard in the worker; per-test stop; global emergency stop; worker aborts on repeated telemetry-write failure. |
| Operator covering their tracks | Delete/alter audit records | Audit + metric rows are append-only at the app layer; production deployments should additionally `REVOKE UPDATE, DELETE` on `"AuditLog"` and `"TestMetric"` from the app role (see below). Audit reads are `ADMIN`-only. |

## Safety controls checklist

- [x] Authentication required for every non-auth endpoint.
- [x] Server-side authorization (`runPreflight`) mandatory before a test starts.
- [x] Authorization, target ownership, and IP are never trusted from the browser.
- [x] Testing restricted to `authorizationStatus = APPROVED` targets.
- [x] Configurable per-target rate / concurrency / duration limits.
- [x] Hard global ceilings from env that the frontend cannot exceed.
- [x] Automatic test-duration limit (engine + worker hard-timeout guard).
- [x] Per-test stop and global emergency-stop.
- [x] Fail-closed when DB / telemetry / safety layer is unavailable.
- [x] No anonymous or "attack any host" mode.
- [x] No botnet, credential theft, persistence, malware, stealth/evasion, or
      exploitation code.
- [x] No CDN/WAF/rate-limit bypass; requests carry a static identifying `User-Agent`.
- [x] Comprehensive, append-only audit log with retention config.

## Trusted proxy / client IP

`TRUSTED_PROXY_MODE` controls how `src/lib/ip.ts` derives the client IP that is
written to `Test.observedIp` and `AuditLog.observedIp`:

- **`none`** (default) — ignore all forwarding headers; use the direct socket
  peer as reported by the platform (`NextRequest.ip`). Correct when the app is
  exposed directly or the platform strips/authoritatively sets the header.
- **`single`** — exactly one trusted reverse proxy in front. Use the **last**
  entry of `X-Forwarded-For` (the hop the trusted proxy appended). A client
  cannot forge that position because the trusted proxy overwrites it.
- **`list`** — multiple known proxies. Set `TRUSTED_PROXIES` to their CIDRs; the
  chain is walked right-to-left discarding trusted addresses, and the first
  untrusted address is recorded.

Never run `single`/`list` unless a proxy you control actually rewrites
`X-Forwarded-For`; otherwise a client could inject a false value.

## Web security controls

- Security headers (CSP, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`) set in `next.config.mjs`.
- Cookies: `HttpOnly` (session), `Secure` in production, `SameSite=Lax`, `Path=/`.
- CORS: no cross-origin API access; mutations require same `Origin` as `APP_URL`.
- Request body size limits in `defineHandler` and a hard payload cap in the
  safety layer.
- Input validation with Zod on every endpoint; Prisma parameterizes all SQL.
- Secrets (`DATABASE_URL`, `SESSION_SECRET`, worker credentials) come only from
  environment variables and are never sent to the client. `.env` is git-ignored.

## Recommended production hardening

```sql
-- Run as the DB owner, against the role your app/worker connect as:
REVOKE UPDATE, DELETE ON "AuditLog"   FROM app_role;
REVOKE UPDATE, DELETE ON "TestMetric" FROM app_role;
REVOKE DELETE          ON "Test"      FROM app_role;  -- keep history
```

- Put a shared rate limiter (e.g. Redis) in front of auth endpoints for
  multi-instance deployments.
- Run the worker with a network egress policy that only allows your approved
  target ranges.
- Ship audit logs to append-only external storage (SIEM / WORM bucket) within
  the `AUDIT_RETENTION_DAYS` window.
- Rotate `SESSION_SECRET` and force re-login on a suspected compromise.

## Handling secrets and sensitive data

- **Never commit secrets.** Passwords, API keys, tokens, private keys, database
  URLs with credentials, `SESSION_SECRET`, `CRON_SECRET`, `WORKER_TICK_SECRET`,
  `RESEND_API_KEY`, `SMTP_URL`, and similar values must only live in environment
  variables / your platform's secret manager. `.env`, `.env.local`, and
  `.env.*.local` are git-ignored; the only committed template is `.env.example`,
  which contains placeholders only.
- **Never paste credentials into issues, pull requests, commit messages, logs,
  or screenshots.** This includes production URLs that embed credentials.
- **Do not include private user data** (real emails, IPs, audit-log exports,
  customer information) in issues or PRs.
- **If a secret is exposed** — committed, logged, screenshotted, or shared —
  treat it as compromised: rotate/revoke it immediately at the provider
  (database password, Resend key, `SESSION_SECRET`, etc.), then update the
  environment. Removing a secret from the current files does **not** remove it
  from Git history; history must be scrubbed separately (e.g. `git filter-repo`)
  and force-pushed, and the credential rotated regardless.
- **Automated scanning.** A `gitleaks` GitHub Actions workflow scans every push
  and pull request. Enable GitHub *secret scanning* and *push protection* in the
  repository settings as an additional layer. Optionally install the local
  pre-commit hook: `git config core.hooksPath .githooks`.

## Reporting

Report suspected vulnerabilities privately to the repository owner
(https://github.com/Ashishnaresh). Do not file public issues with working
exploit steps or with any embedded credentials.
