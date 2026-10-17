# Foundation decisions — 17 October 2026

## Source review and requirements authority

Read `Maintenance_Handoff/PROJECT_HANDOFF.md`, `reference/Build_Plan_v1.0.md`, the snapshot's schema, domain rules, store, seed and frontend/configuration scaffolding, and `source-snapshot/docs/SRS-v1.1-addendum.md`. The snapshot is unfinished scaffolding. It had no working bootstrap/auth/controller/tests/migration and could not be integrated as a tested application.

SRS v1.0 remains the official baseline. The complete original baseline was not supplied. The addendum records clarifications, not a replacement SRS. `SCOPE.md` retains all 20 functional areas.

The original handoff is unchanged and ignored by Git, including company data. No source files from the cloud conversation are assumed accessible.

## Changes from draft schema/store

- Replaced string organization/role/date fields with organization/user/membership relations, a six-value role enum, UUID keys, timestamptz(3) fields, foreign keys, unique constraints and scoped indexes.
- Machine codes are organization-unique; WH-C's primary key is a UUID, its public identifier is `WH-C`.
- Organization-scoped composite foreign keys prevent cross-tenant location/department/machine-access relationships.
- Kept organization, optional department and optional location without inventing actual factory placement. Seed department/location remain null pending confirmation.
- Chose one application membership per verified Supabase user for M1. Multiple organizations per user require an explicit active-organization selection design and additional tests later.
- Operators and technicians need explicit machine grants; maintenance heads, supervisors, plant management and administrators can read registry records in their own organization. This is a reversible M1 **authorization assumption**. Incident write authority is separate from registry read authority.
- Active membership/role/grants are re-read on each request; no browser role, user-editable profile metadata or organization header is trusted.
- Runtime uses scoped Prisma queries; removed the full-state loader, advisory-lock rewrite adapter and file-store concept from application code.
- Did not freeze draft imports/readings/breakdown tables before their milestone requirements are validated. No unimplemented historical-data contract is presented as production-ready.
- Seed and trusted provisioning create audit events transactionally. Audit timestamps are independent UTC instants; an immutable trigger blocks update/delete. There is no audit-edit API. An owner can still alter database triggers, so database-owner access remains trusted administration rather than a tamper-proof external ledger.

## Authentication and database boundary

Supabase browser email/password flow issues sessions. Browser `getSession()` is used only to obtain a token/UI state. NestJS calls the configured Auth server's `getUser(token)` and uses only the returned validated UUID to locate server-controlled records. It never accepts a decoded JWT as proof on its own. Each identity lookup has a bounded provider request; provider unavailability fails closed.

References: [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [Supabase Next.js quickstart](https://supabase.com/docs/guides/auth/quickstarts/nextjs), [Prisma v6 schemas](https://docs.prisma.io/docs/orm/v6/prisma-schema/data-model/multi-schema).

The browser sends a bearer token in `Authorization`; operational requests do not use ambient cookies. CORS allows only configured `WEB_ORIGIN`. This avoids cookie-based CSRF for these API reads. Token persistence uses the Supabase browser library; XSS prevention remains important. M1 exposed reads; later milestone-specific endpoints add guarded operational mutations. Supabase handles credential submission; there is no NestJS password endpoint. Shared distributed rate limiting is deferred until a deployed topology exists.

Application tables live in private `maintenance`, with no Data API/browser grants. RLS is not claimed to inherit a Prisma request identity: the dedicated runtime role has explicit scoped-purpose grants, and record scope is enforced by NestJS queries. Do not expose this schema through Data API or grant it to browser roles. Integration tests check composite FKs, runtime write denial and direct unprivileged SQL denial; actual Supabase project configuration is pending.

Unconfigured development is explicit and fail-closed; production startup rejects missing DB/Auth/HTTPS origin. There is no runtime mock identity adapter. Test doubles exist solely inside test files.

## Persisted maintenance workflow — milestone 4

`apps/api/src/domain/workflow.ts` now supplies the policy used by the persisted work-order API. Operator reporting, assigned-technician repair, maintenance-head approval/return and supervisor OR head closure preserve the confirmed responsibilities. Administrator has no engineering action authority.

Implemented states are `REPORTED → ASSIGNED → IN_PROGRESS → AWAITING_REVIEW → APPROVED → CLOSED`, with return to IN_PROGRESS and reasoned head reassignment from ASSIGNED/IN_PROGRESS. Six labels, head-only assignment, mandatory findings/human RCA/corrective/preventive fields, restoration required at submission, and terminal closure remain provisional pilot choices inherited from the draft and accepted for this implementation, not authoritative missing-SRS requirements. Reassignment clears current repair fields and retains earlier submissions in immutable history. Cancellation/reopening remain deferred.

Persistence adds scoped foreign keys, original report protection, strict request schemas, retry-safe report keys, atomic version compare-and-update, append-only history and transactional audit. Real test-database races prove one update wins; audit failure rolls back state/history. Restoration, submission, engineering approval and closure retain independent instants. See [WORK-ORDERS.md](WORK-ORDERS.md) for the complete contract and limits.

## Package and local environment choices

Pinned Node-compatible Next.js/React/NestJS dependencies with npm lockfile. Stayed on Prisma 6.19.3's supported schema/client API to avoid an unrelated major migration; scoped transitive overrides patch vulnerable dependencies. `deepmerge-ts` 8 is used by Prisma configuration and exercised by generation/migration/tests. Swagger alone receives patched js-yaml 5; OpenAPI tooling retains its compatible version. Only known Prisma/esbuild install scripts are allowed; optional telemetry/native file-watching install scripts are denied.

The native local database is isolated at 55432, with owner and restricted runtime logins; later migrations add narrow operational grants. Docker config is an alternative, unverified here. Runtime logs include correlation ID, method, status, duration and safe error type; no tokens, request bodies, queries or workbook data. No publication/deployment is part of this task.

## Hosted Auth connected — 17 October 2026

Maintenance (`atfjdjliclqzzapetnrr`) in Sarthak Markad, Mumbai, is the real Auth provider. The user created the project and first Auth account through the dashboard, entering passwords themselves. Only the public project URL/publishable key were copied into ignored local configuration; no service-role key was used. The verified Auth UUID was provisioned through the trusted owner CLI as Administrator with WH-C access. A real browser sign-in retrieved WH-C and displayed that server-controlled role.

Operational persistence remains local PostgreSQL with the existing restricted runtime login. Moving application data/schema to the Supabase-hosted database is separate work; no database credentials were received or migrated in this Auth task. Nothing was deployed. Hosted token refresh/expiry/logout and cross-account provider acceptance still need explicit verification.

## Production milestone — 17 October 2026

Added conservative monthly XLSX preview, partial-day selection, transactional import/audit, date/source duplicate constraints and a persisted production/scrap dashboard. See PRODUCTION-IMPORT.md for the parser contract, roles, provenance, precision, concurrency and retention assumptions. The runtime receives narrow production append/status permissions; memberships, registry, existing audit events and saved production values stay protected. Company originals remain unchanged and outside Git. No original file bytes are retained by the app; private Supabase Storage is required when that feature is implemented.

Supabase Auth focus events can re-emit the same session. The frontend now keys authorized data refreshes by token/identity, deduplicates equivalent session events and preserves the open production review while authorized data refreshes. Nested API expiry uses a shared expiry reason to avoid redirect races. Desktop/mobile tests exercise these behaviors; the backend still verifies every new request and reads trusted membership/record permissions.

## Synthetic process readings — 17 October 2026

Milestone 3 preserves the supplied synthetic workbook's hourly grain, explicit Asia/Kolkata wall-clock timestamps, separate receipt times and source rows. A namespace-aware bounded OOXML reader handles the actual prefixed XML, which ExcelJS could not parse. The production reader is unchanged except exposing its existing archive guard for reuse. No original file is edited.

ReadingImport and ProcessReading use scoped foreign keys, source/time and source/ID uniqueness, immutable staged snapshots, append-only operational values and narrow runtime grants. The source is constrained to SYNTHETIC in PostgreSQL. Exact same-preview retries return the original result; cross-preview overlap races roll back. Preview/commit audit events are transactional.

Invented demo bands are versioned as demo-hourly-bands-v1, separate from reported ranges or future engineering settings. Retrospective review is calculated deterministically from saved numeric values at query time after receipt. Formula review columns and Demo_Events are excluded. Consecutive samples are grouped only across adjacent hourly instants in the selected date window; gaps and in-band observations end a group. No duration, industrial fault cause, confirmed breakdown or prediction accuracy is inferred.

The optional trusted local CLI uses the same service and restricted connection, resolves active membership from the database and records LOCAL_CLI audit metadata. Its operator must supply a verified Auth UUID, like the existing provisioning CLI. It is not a login or an application identity bypass. Browser/API authentication remains Supabase-verified.

## Single-identity role views and Google sign-in

The user explicitly requested the same existing Gmail identity for all six roles, declining separate addresses and aliases. Added MembershipRoleGrant rather than duplicate Supabase accounts or changing the default Administrator membership. A browser role selection is only a request; AuthGuard verifies a matching active trusted grant and applies exactly one role on each request. Work-order transactions recheck selected-role access and preserve actual actor-role history. Technician eligibility includes explicitly granted technician roles with machine access. Runtime/database browser roles cannot write grants.

This supersedes the single-role-only assumption while retaining one membership/organization per user. Administrator itself still has no engineering authority; the pilot identity can switch to a separately granted head role. This is not independent-person approval separation. Future staff identities must receive only their real responsibilities. See TEAM-ACCESS.md for the matrix and trusted provisioning behavior.

Added Google sign-in using the existing Supabase browser client with PKCE and explicit callback exchange. API identity verification stays provider-agnostic and always contacts Supabase getUser. Google identity does not create application grants. Public provider settings control button availability, not authorization. Fixed callback destination, URL scrubbing, no-referrer/no-store headers and sanitized errors protect the return flow. The owner subsequently configured Google OAuth and reported checking the login. Hosted provider availability and the real Google redirect were verified; the agent stopped its credential/consent flow at the user’s request. Setup is documented in GOOGLE-SIGN-IN-SETUP.md.

## Planned maintenance — milestone 5, 18 October 2026

The user approved continuing with the calendar and explicitly chose fixed calendar dates over completion-relative recurrence. Implemented IST daily/weekly/monthly anchors, clamped short months without drift, immutable generated occurrences and a PostgreSQL-backed bounded NestJS scheduler with restart catch-up and uniqueness keys. Reminder/occurrence cursor changes and audits are transactional; the local timer is not represented as a deployed durable queue. First-date range, generation horizon, plan/interval limits and pause semantics are pilot implementation choices documented in CALENDAR.md.

Only the maintenance head creates plans/releases tasks or skips unreleased work. Release creates an assigned PLANNED work order with a SCHEDULE event by the actual head; it is not an operator breakdown report or silent automated assignment. Planned completion requires inspection findings, work performed and an independent performedAt; optional follow-up is allowed, while invented breakdown RCA/restoration is rejected. Head review/return and supervisor/head approved closure remain unchanged. BREAKDOWN records keep their previous submission requirements.

Heads/supervisors and assigned technicians receive current-stage in-app reminders with separate read receipts by active role. Pausing stops further generation but retains existing tasks/reminders. No recurrence edits, external notification delivery, invented production schedules or new auth grants were added. See CALENDAR.md for full behavior and verification limits.
