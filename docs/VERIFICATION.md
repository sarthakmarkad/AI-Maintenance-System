# Verification — 17 October 2026

## Actual local results

Environment: macOS arm64, Node 24.18.0, npm 11.16.0, PostgreSQL 16.15 in the isolated project instance at 127.0.0.1:55432. Tests were executed locally; no deployed environment is claimed.

| Check | Result | Evidence / limits |
|---|---|---|
| Folder access | PASS | Actual Maintenance root verified; temporary file/folder created, read and removed |
| Dependency installation | PASS | Lockfile generated; Prisma client generated; known build scripts explicitly allowed |
| Dependency audit | PASS | npm audit: 0 vulnerabilities after targeted compatible dependency patches |
| Type checks | PASS | Strict TypeScript for NestJS and Next.js |
| Backend production compilation | PASS | tsc emits runnable NestJS application |
| Frontend production build | PASS | Next.js builds login, registry and dynamic machine page |
| Backend/config/verifier/workflow tests | PASS, 14 | HTTP 401/403/404/400; trusted membership; invalid token; unconfigured auth; input validation; role distinctions; assignment restrictions; stale policy versions; separate timestamps |
| Real PostgreSQL integration tests | PASS, 8 | Fresh migration, repeated seed, actual scoped queries, immediate revocation, composite FK and uniqueness rejection, keyset pagination, runtime write denial, immutable audit, unprivileged SQL denial |
| Browser tests | PASS, 12 | Six scenarios each in desktop Chromium and Pixel 7 emulation; login/navigation, loading/empty, API retry, expiry, invalid login, logout and horizontal layout |
| Initial unconfigured local smoke | PASS | Actual running API: liveness 200, readiness 503 with database connected/auth unconfigured, protected endpoints 401, OpenAPI 200 |
| Initial unconfigured browser | PASS | Real local frontend redirects to login, shows setup notice, disables sign-in and fits mobile width; no interception for this check |
| Reference/privacy boundary | PASS | Handoff, company files, .env, frontend local environment, native DB and test artifacts ignored by Git; no originals changed or copied into public assets |

The browser suite deliberately intercepts Supabase and API responses. Those 12 passes prove client behavior against fixtures, not hosted login or browser-to-real-API authentication. The verifier tests exercise the actual Supabase SDK against a controlled local Auth HTTP stub; they do not prove hosted Supabase token verification. Database HTTP tests use real PostgreSQL and test-only identity injection. No identity bypass is available in the application.

An expiry redirect race was found by browser testing and fixed. Early runs also exposed missing browser installation and ambiguous selectors; the final browser suite passed all 12 tests. Browser tests use an isolated .next-test directory and can run while local development remains active.

## Not verified / not implemented

- Hosted session refresh, expiry and logout against this actual project are not yet exercised; successful real sign-in and WH-C retrieval are verified below.
- A Supabase-hosted PostgreSQL migration, restricted grants, pooler behavior or Data API schema exposure settings.
- Production deployment, hosting, TLS/proxy configuration or Docker startup. Nothing was published.
- Hosted GitHub Actions execution; workflow is included for future runs.
- Work-order persistence/concurrent database updates: only the pure future policy contract is tested. Atomic version checking/audit for incident mutations belongs to its milestone.
- Production Excel parsing/import, persisted production dashboard values, process readings, private Storage, queues, anomaly detection, AI, notifications, reports or the remainder of the 20-feature platform.
- Performance/availability/prediction claims, engineering safe limits, downtime units or actual shift start times.

## Hosted Auth connection follow-up — 17 October 2026

- Verified project **Maintenance**, reference `atfjdjliclqzzapetnrr`, in **Sarthak Markad**, Free plan, Mumbai; dashboard reports Healthy.
- Project creation was completed by the user, including database password entry. No application was deployed.
- Installed the project URL and public publishable key in ignored `.env` and `apps/web/.env.local`, preserving existing local database URLs. No secret/service-role key was retrieved or exposed.
- Hosted `/auth/v1/settings`: HTTP 200; email provider enabled and email confirmation enabled.
- Hosted `getUser` rejects an invalid token (403 from provider); NestJS maps it to HTTP 401.
- Hosted password endpoint rejects invalid test credentials with HTTP 400 / `invalid_credentials`. This is a real provider request, not a successful-login claim.
- After restarting development: `/api/health/ready` returns HTTP 200 with database connected and authentication configured; `/api/me` rejects missing/invalid tokens with HTTP 401.
- User completed creation of the requested Auth account. Verified its UUID in the project user list and provisioned its Administrator membership through the trusted owner CLI. Administrator does not imply engineering approval authority. Account email/UUID are not recorded in this source document.
- Configured local login renders successfully without the missing-configuration notice.
- **Successful real sign-in verified:** the user entered the application password directly in the local browser. Observed `/machines/WH-C`, the database-provisioned Pilot administrator / Administrator identity, Supreme Industries, and WH-C machine details. This run used the actual hosted Supabase Auth project, real NestJS verifier, and local PostgreSQL; no browser interception, test identity, or mock API was used. No password/session token was read or stored by the agent. A screenshot is retained under ignored `.local/maintenance-authenticated.png`.
- Re-ran all 14 backend tests and strict TypeScript checks successfully after configuration. The configured frontend production build is checked independently of its running development cache.

## Configuration notes after hosted setup

Root `.env`:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (public publishable key or legacy anon key)
- For eventual Supabase persistence: appropriate `DATABASE_URL` runtime and `DIRECT_URL` migration credentials. Local PostgreSQL URLs already exist privately.

`apps/web/.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_API_URL` (already points to the local NestJS API)

The hosted Auth URL/public key and first-user application membership are now configured on this computer. Supabase-hosted operational database credentials/grants remain pending; local PostgreSQL is still the runtime data store. Do not paste secrets into source or commit them.

## Remaining live acceptance checklist

1. DONE: Configure Supabase Auth and matching frontend URL/public key; restart the app.
2. DONE: User created the Auth account; verified UUID and provisioned the trusted application membership and WH-C access.
3. DONE: Observed real sign-in and WH-C retrieval through the connected app; retained non-secret screenshot evidence locally.
4. Verify invalid credentials, token expiry/refresh, logout and temporary provider failure with that project.
5. With separate actual role and organization accounts, verify unauthorized role/action, ungranted-machine and cross-organization denial.
6. If switching persistence to Supabase, run the migration/seed/grants in an authorized non-production test environment; confirm the maintenance schema is not exposed and direct browser access fails.

## Next milestone

Authentic production Excel preview, source sheet/row validation, ambiguous-value review, duplicate-safe persisted commit and dashboard production/scrap totals. Preserve job-grain rows and daily control totals separately. Data assumptions remain recorded in DATA-POLICY.md.
