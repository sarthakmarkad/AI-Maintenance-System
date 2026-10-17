# Verification — 17 October 2026

## Actual local results

Environment: macOS arm64, Node 24.18.0, npm 11.16.0, PostgreSQL 16.15 in the isolated project instance at 127.0.0.1:55432. Tests were executed locally; no deployed environment is claimed.

| Check | Result | Evidence / limits |
|---|---|---|
| Folder access | PASS | Actual Maintenance root verified; temporary file/folder created, read and removed |
| Dependency installation | PASS | Lockfile generated; Prisma client generated; known build scripts explicitly allowed |
| Dependency audit | PASS | npm audit: 0 vulnerabilities after targeted compatible dependency patches |
| Type checks | PASS | Strict TypeScript for NestJS, Next.js and browser tests |
| Backend production compilation | PASS | tsc emits runnable NestJS application |
| Frontend production build | PASS | Next.js builds login, registry, machine and production pages; isolated build cache preserves the running dev server |
| Backend/config/verifier/workflow/parser tests | PASS, 20 | Foundation HTTP/auth/workflow checks plus cached formulas, multiple jobs per shift, activity rows, dates, controls, numeric ambiguity and XLSX input bounds |
| Real PostgreSQL integration tests | PASS, 16 | Foundation constraints/access plus staged imports, selected-day validation, same-preview idempotency, cross-preview races, renamed files, source isolation, audit rollback, preview expiry, immutable snapshots and narrow runtime grants |
| Browser tests | PASS, 20 | Ten scenarios each in desktop Chromium and Pixel 7 emulation; foundation flows plus import review/acknowledgement/commit, source separation, role visibility, conflict recovery, nested expiry and tab switching |
| Initial unconfigured local smoke | PASS | Actual running API: liveness 200, readiness 503 with database connected/auth unconfigured, protected endpoints 401, OpenAPI 200 |
| Initial unconfigured browser | PASS | Real local frontend redirects to login, shows setup notice, disables sign-in and fits mobile width; no interception for this check |
| Reference/privacy boundary | PASS | Handoff, company files, .env, frontend local environment, native DB and test artifacts ignored by Git; no originals changed or copied into public assets |

The browser suite deliberately intercepts Supabase and API responses. Those 20 passes prove client behavior against fixtures, not hosted login or browser-to-real-API authentication. The verifier tests exercise the actual Supabase SDK against a controlled local Auth HTTP stub; they do not prove hosted Supabase token verification. Database HTTP tests use real PostgreSQL and test-only identity injection. No identity bypass is available in the application.

An expiry redirect race was found by browser testing and fixed. Early runs also exposed missing browser installation and ambiguous selectors; the final browser suite passed all 20 tests. Browser tests use an isolated .next-test directory and can run while local development remains active.

## Not verified / not implemented

- Hosted session refresh, expiry and logout against this actual project are not yet exercised; successful real sign-in and WH-C retrieval are verified below.
- A Supabase-hosted PostgreSQL migration, restricted grants, pooler behavior or Data API schema exposure settings.
- Production deployment, hosting, TLS/proxy configuration or Docker startup. Nothing was published.
- Hosted GitHub Actions execution; workflow is included for future runs.
- Work-order persistence/concurrent database updates: only the pure future policy contract is tested. Atomic version checking/audit for incident mutations belongs to its milestone.
- Process readings, original workbook-byte storage/private Storage, queues, anomaly detection, AI, notifications, reports or the remainder of the 20-feature platform. Production Excel import and saved dashboard values are verified below.
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

Synthetic hourly process-reading import with separate measured/received timestamps, duplicate/gap/unit validation, visible synthetic provenance and retrospective review warnings. Reported ranges are unverified and cannot establish safe limits or causes of authentic production losses. Persistent incident workflows follow that milestone.

## Production import acceptance — 17 October 2026

- Applied the production migration to the actual local database and isolated test database; applied the narrow runtime grants. No hosted database migration is claimed.
- Final relevant automated runs passed: **20 backend/unit + 16 PostgreSQL integration + 20 desktop/mobile browser = 56 tests**, strict type checks and NestJS/Next.js production builds. Generated OpenAPI and frontend contracts were refreshed. Dependency audit reported zero vulnerabilities, including the production dependency recheck after live import. Hosted CI has not been run.
- The authenticated user's actual Chrome tab selected the original WH-C workbook. Real inspect and preview requests listed its worksheets and validated the September sheet using hosted Supabase identity, NestJS and local PostgreSQL. No response interception or injected test identity was used in this live flow.
- Reviewed 30 date blocks: 27 eligible; excluded a missing date (A23), malformed date (A57), and independent scrap-control mismatch (AD91). No date or quantity was corrected automatically.
- Committed the 27 valid days through the application UI. Observed 160 JOB rows and two ACTIVITY rows in the database, with exactly one corresponding commit audit event and three excluded blocks. Reloaded the real page and observed retained September coverage, totals, daily chart, gaps and import history.
- Independently recalculated eligible production and category-scrap totals from the original worksheet's cached XML values before import. Saved decimal day/control totals match that evidence. Retained descriptions, shifts, remarks, source row references and category values match the parsed source; saved raw-cell JSON matches the staged database snapshot exactly. Raw numeric cache values are parsed floating-point JSON, not byte-for-byte XML text; independent raw-cache comparisons allow relative tolerance 1e-12. Production/control amounts are checked exactly at three decimals.
- SHA-256 checks after the live import confirm all supplied original workbooks remain unchanged. Company volumes, detailed source evidence and screenshots remain in ignored `.local` and the private database. Screenshot: `.local/production-dashboard.png`; detailed live comparison: `.local/production-live-verification.json`.
- Desktop/mobile fixture screenshots were inspected for layout. The live saved daily chart was also visually checked after rendering. Browser fixtures prove client behavior; the separate live run proves this actual workbook's browser-to-database path. Hosted session refresh/expiry, separate real role accounts, Supabase-hosted operational persistence and deployed operation retain the limits stated above.

## Local address recovery — 17 October 2026

The reported offline workspace was open at `127.0.0.1:3000`, while the configured API CORS origin is `localhost:3000`. Frontend, API readiness and the database were already healthy. Added a development-only redirect to the canonical localhost origin when using the configured localhost pilot API. Verified HTTP 307 preserves the production path and query string. API origin permissions remain unchanged. Strict type checks pass. Reloading the actual Chrome tab followed the redirect and restored the trusted Administrator registry. The production dashboard then loaded all 27 saved days and 160 jobs. Local screenshot: `.local/production-access-restored.png`.
