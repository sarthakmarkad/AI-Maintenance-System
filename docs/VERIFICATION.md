# Verification — 18 October 2026

## Actual local results

Environment: macOS arm64, Node 24.18.0, npm 11.16.0, PostgreSQL 16.15 in the isolated project instance at 127.0.0.1:55432. Tests were executed locally; no deployed environment is claimed.

| Check | Result | Evidence / limits |
|---|---|---|
| Folder access | PASS | Actual Maintenance root verified; temporary file/folder created, read and removed |
| Dependency installation | PASS | Lockfile generated; Prisma client generated; known build scripts explicitly allowed |
| Dependency audit | PASS | npm audit: 0 vulnerabilities after targeted compatible dependency patches |
| Type checks | PASS | Strict TypeScript for NestJS, Next.js and browser tests |
| Backend production compilation | PASS | tsc emits runnable NestJS application |
| Frontend production build | PASS | Next.js builds login, registry, machine, production, reading, work-order and calendar pages; isolated build cache preserves the running dev server |
| Backend/config/verifier/workflow/parser/recurrence tests | PASS, 31 | Foundation/production checks plus namespace-aware reading XML, local/UTC conversion, both Excel date systems, duplicate/invalid rows, empty numeric caches, invented bands, label exclusion and gap-separated reviews; fixed recurrence, short months/leap years, IST dates and exact deadlines |
| Real PostgreSQL integration tests | PASS, 41 | Foundation/production checks plus reading scope/roles, staged provenance, idempotent and racing commits, ID/time conflicts, retained receipt times, trend gaps, audit rollback, expiry and protected readings; full work-order authorization/state sequence, report retries, competing versions, reasoned reassignment, audit rollback, long history and SQL protections; single-identity role grants, import allow/deny matrix, revocation and trusted provisioning; scoped recurring plans, duplicate-safe jobs, role-specific reminders, release/skip races, reviewed planned completion, generation/audit rollback and SQL protections |
| Browser tests | PASS, 74 | Thirty-seven scenarios each in desktop Chromium and Pixel 7 emulation; foundation/production flows plus reading review/commit/reload/source history, chart layout, roles, conflicts and expiry; operator reporting, head assignment, technician submission, return/resubmission, approval/closure and stale-action reload; Google PKCE/error/retry paths and six-role selection; calendar date/status views, recurring plan retry, pause/resume/skip, planned release/submission, reminders and stale actions |
| Initial unconfigured local smoke | PASS | Actual running API: liveness 200, readiness 503 with database connected/auth unconfigured, protected endpoints 401, OpenAPI 200 |
| Initial unconfigured browser | PASS | Real local frontend redirects to login, shows setup notice, disables sign-in and fits mobile width; no interception for this check |
| Reference/privacy boundary | PASS | Handoff, company files, .env, frontend local environment, native DB and test artifacts ignored by Git; no originals changed or copied into public assets |

The browser suite deliberately intercepts Supabase and API responses. Those 74 cases prove client behavior against fixtures, not hosted login or browser-to-real-API authentication. The verifier tests exercise the actual Supabase SDK against a controlled local Auth HTTP stub; they do not prove hosted Supabase token verification. Database HTTP tests use real PostgreSQL and test-only identity injection. No identity bypass is available in the application.

An expiry redirect race was found by browser testing and fixed. Early runs also exposed missing browser installation and ambiguous selectors; the previous browser suite passed all 28 tests; M4 adds fourteen passing workflow cases. Browser tests use an isolated .next-test directory and can run while local development remains active.

## Not verified / not implemented

- Hosted session refresh, expiry and logout against this actual project are not yet exercised; successful real sign-in and WH-C retrieval are verified below.
- A Supabase-hosted PostgreSQL migration, restricted grants, pooler behavior or Data API schema exposure settings.
- Production deployment, hosting, TLS/proxy configuration or Docker startup. Nothing was published.
- Hosted GitHub Actions execution; workflow is included for future runs.
- Separate actual hosted operator, technician, head and supervisor accounts for live multi-user work-order acceptance. Persistence, concurrency and atomic audit are verified in the isolated test database.
- Original workbook-byte storage/private Storage, deployed queues, industrial anomaly detection, AI, external notification delivery, reports or the remainder of the 20-feature platform. Production import and synthetic hourly trends/review rules are verified below.
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

A separate statistical anomaly service. Planned maintenance/calendar and in-app due reminders are implemented locally; live calendar acceptance with hosted login, independent actual staff identities and hosted operational persistence retain the limits below.

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

## Synthetic readings acceptance — 17 October 2026

- Applied milestone-3 migration and narrow runtime grants to the operational local PostgreSQL database and isolated test database. Supabase-hosted persistence remains pending.
- Current automated suite: **27 unit/backend + 22 PostgreSQL integration + 28 desktop/mobile browser = 77 tests**. The eight reading browser cases were rerun after final layout/source-review changes. Strict type checks, API compilation, Next.js production build and dependency audit also pass. Hosted CI is not claimed.
- Independently read the supplied original worksheet XML, compared every source ID, all 1,008 parameter values and every IST/UTC timestamp with parser staging. All 336 observations are eligible; no scheduled hourly gaps. Review counts are 3 hot, 5 cold and 5 pressure values, grouped into four retrospective review periods. Evidence stays in `.local/readings-source-verification.json`.
- Loaded the supplied workbook through the trusted local CLI using the existing verified/provisioned pilot Administrator UUID and restricted runtime connection. This is explicitly LOCAL_CLI in the preview/commit audit metadata, not a hosted browser-upload or Auth-verification claim. Same parser/service/transaction path is used. Actual import: 336 readings, one commit audit event, separate measurement/receipt timestamps, immutable raw cells and matching decimal values. Full source comparison is retained in `.local/readings-live-verification.json`. Re-running the actual CLI import excluded all 336 existing observations; database count stayed 336 with exactly one commit audit.
- After loading, the actual signed-in Chrome page retrieved saved readings through hosted Supabase Auth, the NestJS API and local PostgreSQL. Observed retained September coverage, 336 observations, zero missing hours, 13 unique review samples, four periods, all three parameter summaries, source history and separate dataset measurement/receipt times. Visually inspected the real hot-temperature chart and labels; screenshots are `.local/process-readings-dashboard.png` and `.local/process-readings-chart.png`. No intercepted API or test identity was used for this read.
- **Actual browser upload verified after the user unlocked the Mac:** Chrome extension file access remained disabled, so selected the original workbook through the standard macOS file picker. The signed-in page sent the actual multipart preview to NestJS. Observed 336 source rows, zero eligible new observations and 336 already-imported exclusions. Even after acknowledgement, Import 0 valid observations stayed disabled. Database evidence confirms an API-origin preview, all existing rows excluded, exactly 336 saved readings and the original single commit audit. No extra commit was attempted because no new rows existed. Screenshot: `.local/readings-live-upload-duplicate.png`. New-reading commit is covered by the actual CLI service run, real PostgreSQL HTTP tests and desktop/mobile fixture tests; a separate new-data browser commit is not claimed.
- Operational checks compare all saved readings, raw-cell snapshots, counts and review groups with independent source evidence. Authentic production counts and exact totals remain unchanged. All supplied original workbook SHA-256 checksums are unchanged and private files remain ignored by Git.

## Maintenance workflow acceptance — 17 October 2026

- Applied migration 202610170004 and narrow runtime grants to local operational and isolated test databases. No hosted database migration or deployment occurred.
- Verified **27 backend/unit + 31 real PostgreSQL integration + 42 desktop/mobile browser cases = 100 passing cases**. The combined browser run passed the prior 28 and ten new cases; two new selectors failed in each viewport. After using semantic combobox locators, all fourteen new workflow cases passed. Strict TypeScript, regenerated OpenAPI 0.4 contracts, NestJS/Next.js production builds and npm audit (zero vulnerabilities) also pass.
- Real database HTTP tests verify trusted roles/org/machine scope, active eligible assignments, concurrent identical report retries, changed retry rejection, assigned-only repairs, required human RCA/actions and calendar-valid independent restoration time. They exercise reasoned reassignment, return/resubmission evidence, head-only approval, supervisor/head closure, Administrator denial, competing version updates and complete paginated history beyond fifty events. Audit failure rolls back state/history; runtime SQL cannot edit original report columns/history/audit, and CLOSED is terminal.
- Browser fixtures verify report drafts/request keys across failed retries, eligible assignment, technician start/submission, return/resubmission/approval/closure, Administrator read-only behavior, conflict blocking until reload, status filters and expired authentication. Desktop/mobile detail layouts fit their viewports; saved screenshots were inspected. These fixtures do not prove hosted multi-role authentication.
- The actual signed-in Administrator retrieved the new empty Work orders page in **Codex's built-in in-app browser**, through hosted Supabase Auth, the real NestJS API and local PostgreSQL. Observed correct trusted identity, zero incidents and no operational action controls. No browser response interception, role changes or fake operational incidents were used. Screenshot: `.local/work-orders-admin.png`.
- Final private data checks preserve all original September records (27 days, 160 jobs, two activity rows), exact totals and staged source evidence. An additional existing October import contains thirteen days: operational production now has forty saved days, all matching their stored import snapshots. The milestone does not remove or rewrite that import. All 336 reading IDs/values/measurement times/raw cells match staging; separate receipt times, zero gaps, thirteen review observations, four groups and the single commit audit remain intact. Original workbook SHA-256 hashes are unchanged. Evidence: `.local/work-orders-verification.json`.
- The operational database contains zero work orders and zero work-order events after verification. The full workflow ran only against the isolated test database or browser fixtures. Private evidence, credentials, handoff/company originals and generated test artifacts remain ignored by Git.
- Current account remains Administrator. Live multi-user acceptance requires separately provisioned actual operational-role accounts; this milestone does not manufacture Auth users or grant the current Administrator engineering authority. Notifications, calendar/scheduled maintenance, attachments, cancellation/reopening, KPI calculations and AI diagnosis remain future work.

## Single-account role access and Google OAuth — 17 October 2026

- The user explicitly requested the same existing email identity for every role and declined separate email addresses/aliases. Preserved its default Administrator membership and created five additional trusted MembershipRoleGrant records (Operator, Technician, Maintenance head, Supervisor, Management) in local operational PostgreSQL. No duplicate Supabase users, new passwords, email invitations or identity bypass were created. The grant transaction appended one protected audit record. Re-running provisioning added zero grants and no duplicate audit event.
- Active role applies exactly one verified role on each request. Available roles are returned from trusted active records; ungranted/invalid/revoked selection fails closed. Work-order transactions recheck the selected role; technician eligibility includes explicitly granted technician roles with machine access. Default Administrator itself still cannot approve/repair/close. This single pilot identity can perform different responsibilities sequentially, so independent-person approval separation is not claimed.
- Final relevant suite: **27 unit/backend + 33 PostgreSQL integration + 60 desktop/mobile browser = 120 passing test cases**. Type checks, generated OpenAPI/types, production builds and npm audit (zero vulnerabilities) pass. New tests verify six-role selection without permission unions, import allow/deny checks, acting-role history, revoked grant/machine denial, owner-only/idempotent role provisioning and audited machine-access restoration. Browser checks cover Google PKCE, missing verifier, cancellation, expired code, no membership, provider/API outage recovery, sign-out/default restoration and rejected role recovery. An initial missing-verifier fixture attempted to change storage during navigation; it was corrected to exercise a callback without an initiating verifier, after which the entire sixty-case browser suite passed.
- In Codex's built-in browser, the actual signed-in pilot identity successfully selected all six views and retrieved WH-C through the real hosted Supabase verifier and local API/database. Operator displayed Report an issue; Technician displayed assigned-repair guidance; all six selected role labels and registry scope were observed. Returned the app to Administrator/work orders. No operational incidents were fabricated. Screenshot: `.local/team-access-operator.png`; private evidence: `.local/team-access-verification.json`.
- Existing forty production days match stored import snapshots; original September totals are preserved. All 336 reading IDs/values/timestamps/raw cells match staging and original workbook SHA-256 hashes remain unchanged. Operational work orders/events remain zero after checks. Company data, credentials and local/test artifacts stay ignored by Git.
- Implemented Google button with live provider availability, PKCE browser flow, single-use callback exchange, fixed internal destination, URL scrubbing, sanitized failures and callback no-referrer/no-store headers. Application access still requires trusted membership; Google login cannot grant a role. Existing password login supports all six views and stays available alongside Google.
- **Hosted Google enabled; login checked by the owner.** After the owner completed setup, public hosted Auth settings returned HTTP 200 with Google and email enabled. The actual local login rendered an enabled Google button and redirected to the real Google account chooser using the hosted Supabase callback and localhost app return address. No client secret was retrieved. The owner then stated they had checked the login themselves and asked the agent to stop; the agent did not complete Google credentials/consent or independently inspect the resulting callback identity/linkage. Screenshot of the enabled real login: `.local/google-sign-in-enabled.png`. Setup instructions are retained in GOOGLE-SIGN-IN-SETUP.md. Fixture OAuth successes are not presented as agent-observed hosted sign-in success.
- Supabase-hosted operational persistence/deployment and independent staff-identity/cross-organization live acceptance retain their prior limits. See TEAM-ACCESS.md for the current access matrix and single-account pilot boundary.


## Planned maintenance acceptance — 18 October 2026

- The user explicitly chose fixed calendar dates. Daily/weekly/monthly recurrence preserves its original IST anchor regardless of late completion; short-month clamping returns to the original day in subsequent months. Plans, occurrence snapshots and due/current-stage reminders persist in PostgreSQL.
- Applied migration 202610180006 and narrow runtime grants to local operational and isolated test databases. Generated OpenAPI 0.5.0 and frontend contracts match the calendar routes and planned-work fields. No hosted database migration or deployment occurred.
- Final automated suite: **31 backend/unit + 41 real PostgreSQL integration + 74 desktop/mobile browser = 146 passing cases**. The full browser suite passed, and all fourteen calendar browser cases passed again after the final control/history refinements. Strict TypeScript, NestJS/Next.js production builds and npm audit (zero vulnerabilities) pass.
- Real PostgreSQL HTTP tests cover all six read roles, head-only plan/state/release/skip actions, organization/machine scope and revoked grants; stable creation/release retries, fixed-date pause/resume catch-up, complete paging/counts, reminder deduplication/current ownership and per-role read receipts. Competing release/skip requests cannot both succeed. Planned start, submit, return, resubmit, approval and closure run without invented breakdown RCA/restoration; breakdown requirements remain unchanged.
- Injected audit failures roll back plan creation, work-order release, occurrence insertion/cursor advancement and reminder creation. Subsequent job retries succeed without duplicates. Restricted SQL cannot rewrite immutable plans/snapshots/reminders/receipts or bypass protected workflow fields.
- Browser fixtures cover calendar/day/status layout, plan creation and failed retry drafts, IST form conversion, pause/resume/skip, explicit release, planned technician submission, reminder reads, Administrator read-only controls, conflict reload and expiry. Desktop/mobile calendar and creation-form screenshots were inspected and fit the viewport. These checks use isolated test data and do not prove a hosted calendar session.
- Actual stored-role service reads and an empty scheduler run used the restricted operational connection through trusted local administration. Only the Maintenance head view could manage plans. The built-in browser redirected to login; no new credential entry, intercepted operational browser responses or authenticated live calendar acceptance is claimed.
- Compared existing records with the pre-calendar checkpoint: forty production days, 231 production rows, 336 synthetic readings, one user-created breakdown order and its six events, one membership and five additional role grants remain unchanged apart from the new default BREAKDOWN/null planned fields. This supersedes the earlier milestone's historical zero-work-order count. Original workbook SHA-256 hashes are unchanged. No company plan, occurrence, reminder or fake incident was inserted. Private evidence is retained in `.local/calendar-verification.json`; screenshots and test artifacts remain ignored by Git.
- The first real plan is intentionally left for the user's Maintenance head view. The worker runs at API startup and every thirty seconds, with persisted cursors and bounded restart catch-up. Existing generated tasks remain due when a plan is paused. This is an in-app local reminder feature; email/SMS/push, deployed queue availability and separate-person approval acceptance are not claimed. Full behavior and limits are documented in CALENDAR.md.
