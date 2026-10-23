# Supreme Maintenance Intelligence

Local milestones 1–8 for Supreme Industries' **WH-C**, the newer Windmöller & Hölscher blown-film line. Its exact model is unknown. This repository implements authenticated access, production workbook import and dashboards, synthetic hourly trends, role-controlled maintenance work orders, and fixed-date planned maintenance with in-app reminders, explainable statistical pattern review, maintenance workflow performance, and private work-order attachments. Further platform milestones remain in scope.

## Start here

The project lives at `~/Documents/Projects/Maintenance` (the filesystem also resolves the user's lowercase `projects` path). No code is built in the ChatGPT project mirror.

Prerequisites: Node 22.12–24, npm 11, Python 3.9+ available as `python3` on PATH. Native PostgreSQL 16 is available on this computer; Docker is an alternative.

```sh
cd ~/Documents/Projects/Maintenance
npm ci
# Existing setup: this safely starts the isolated project database again.
# First setup: creates a private .env only if none exists.
npm run db:local
npm run db:migrate
npm run db:seed
npm run db:grants
# First setup only: copy apps/web/.env.example to apps/web/.env.local if absent.
npm run dev
```

- Frontend: http://localhost:3000
- Use `localhost` for the local pilot. Development requests to `127.0.0.1` redirect there when the API is configured for localhost, keeping authentication and API origin settings consistent.
- NestJS API: http://localhost:4000/api
- Swagger: http://localhost:4000/api/docs
- OpenAPI JSON: http://localhost:4000/api/openapi.json
- Liveness: `/api/health/live`; readiness: `/api/health/ready`

The native database uses **127.0.0.1:55432**, `.local/pgdata`, and its own credentials. It does not use the existing PostgreSQL instance on port 5432. Stop it with `npm run db:local:stop`. Do not delete `.local/pgdata` if you need its records.

For a fresh checkout, the API can start without Supabase credentials but fails closed: unauthenticated protected requests return 401, bearer requests cannot authenticate, and readiness returns 503. The login screen explains missing setup and disables sign-in. This is intentional; there is no mock/development login or runtime file store.

## Connect actual Supabase authentication

1. Create/select an authorized Supabase project. Obtain its URL and **public publishable key** (or legacy anon key). Do not put a secret/service-role key in frontend configuration.
2. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in root `.env`.
3. Set the same URL/key as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `apps/web/.env.local`. `NEXT_PUBLIC_API_URL=http://localhost:4000/api`.
4. Create the pilot user's email/password account in Supabase Auth using trusted administration. Confirm the account as appropriate; copy its actual Auth UUID. No public self-signup or role-enrollment endpoint is implemented.
5. Provision a trusted application membership, e.g.:

```sh
npm run db:provision -- <actual-auth-user-uuid> OPERATOR "Display name" WH-C
```

Allowed roles: `OPERATOR`, `TECHNICIAN`, `MAINTENANCE_HEAD`, `SUPERVISOR`, `MANAGEMENT`, `ADMINISTRATOR`. Operators/technicians require an explicit machine grant. The CLI creates new memberships only and does not silently change existing roles. For explicitly approved multi-role pilot access on an existing identity, see [team access](docs/TEAM-ACCESS.md) and the separate trusted `db:grant-roles` command. It uses `DIRECT_URL` and writes membership/grants/audit atomically. The owner must verify the supplied UUID belongs to the intended Auth user.

6. Restart local development after environment changes; sign in and verify `/api/me` and `/api/machines/WH-C`. Complete the hosted acceptance checklist in `docs/VERIFICATION.md`.

Local PostgreSQL can be used with hosted Supabase Auth for development. Production persistence must use PostgreSQL/Supabase as agreed; no hosting or paid account is configured.

## Google sign-in and role views

Email/password login supports every trusted application role. The existing pilot account now offers six individually enforced role views, without duplicate Auth users or shared permission unions. See [the role matrix and enforcement](docs/TEAM-ACCESS.md).

Google OAuth application code and tested PKCE callbacks are implemented. The owner has configured Google OAuth; hosted provider availability and the real redirect to Google were verified, and the owner reports checking the login. The button reads actual provider availability; existing email sign-in stays usable. Follow [the exact Google setup guide](docs/GOOGLE-SIGN-IN-SETUP.md). No Google client secret belongs in frontend settings.

## Database configuration

`DATABASE_URL` is the restricted runtime connection. Imports and maintenance workflows need the milestone-specific narrow grants; run `npm run db:grants` after migrations. `DIRECT_URL` is an owner/migration connection; keep it out of the running API environment in a deployed environment. Prisma migrations/seed/provisioning use owner credentials, not browser tokens. The private `maintenance` schema is not intended for exposure through Supabase Data API. The initial migration revokes public and existing Supabase browser/service role grants; no browser table policies or browser database access are used.

For Supabase, use provider-supported PostgreSQL URLs (direct connection or session pooler for migrations; suitable pooled runtime connection where needed). Keep `maintenance` out of exposed schemas. Create a dedicated non-owner runtime LOGIN without role-administration privileges, then run `npm run db:grants`. Runtime permissions keep identity/registry read-only and narrowly permit production/reading/work-order/history/audit inserts plus import-state and versioned workflow updates. **Do not use the database owner as DATABASE_URL in production.** Supabase project grants/pooler behavior remain unverified until that project is configured.

If using Docker instead of native PostgreSQL:

```sh
LOCAL_DB_PASSWORD=<choose-private-password> docker compose -f infra/docker-compose.yml up -d
```

Copy `.env.example` to `.env`, set the owner URL, create a restricted runtime login with a private password using trusted PostgreSQL administration, and set its URL. Then migrate, seed, and apply runtime grants. Docker was not exercised on this computer.

## Commands and checks

```sh
npm run typecheck
npm test                    # backend HTTP, configuration, verifier and workflow contract
npm run test:db             # isolated *_test database only; migrates, seeds twice, applies grants
npm exec playwright -- install chromium
npm run test:web            # desktop + mobile; intercepted Auth/API fixtures; isolated build cache
npm run build               # NestJS TypeScript + Next.js production build
npm run api:generate        # OpenAPI JSON + generated frontend response types
npm audit
```

Database tests require `TEST_DATABASE_URL` (owner) and `TEST_RUNTIME_DATABASE_URL` (restricted login), pointing to the same separate database ending in `_test`. Native bootstrap creates these privately. Do not point tests at operational databases. CI configuration is included; its hosted execution has not been observed.

## Repository

| Path | Purpose |
|---|---|
| `apps/web` | Next.js App Router, Supabase login, protected registry/machine pages, Excel review, production dashboard, synthetic process trends, maintenance workflow and calendar, Tailwind/shadcn-style components and Recharts |
| `apps/api` | NestJS REST, verified identity, trusted membership lookup, scoped machine queries, errors/logging/health/Swagger, bounded XLSX parser, staged imports, production totals, synthetic reading trends, scoped statistical review, versioned work-order actions and durable schedule/reminder processing |
| `packages/api-client` | Generated OpenAPI response types consumed by frontend |
| `services/statistics` | Isolated, standard-library Python worker for causal synthetic pattern rules; launched by NestJS |
| `prisma` | Reviewed foundation schema, migration, relational constraints and indexes |
| `scripts` | Seed, trusted account provisioning, isolated database and contract generation |
| `infra` | Local PostgreSQL Compose option and narrow runtime grants |
| `docs` | Decisions, data boundaries, complete scope map and verification evidence |
| `Maintenance_Handoff` | Ignored, unchanged local reference material and original workbooks |

Work-order photos/documents are retained privately in PostgreSQL with immutable metadata; see [attachment workflow and limits](docs/ATTACHMENTS.md). Production XLSX uploads are parsed in memory; source rows and reconciled daily records persist in PostgreSQL. Original file-byte storage is deferred to private Supabase Storage. Recharts renders saved quantities with gaps. A bounded NestJS calendar worker persists occurrence cursors and in-app reminders in PostgreSQL. A separate bounded Python process evaluates synthetic statistical patterns on demand, without database/provider credentials. No Redis queue, pgvector or AI provider is introduced. Future service directories will be added with their implementation.

## Current boundary and next milestone

The local app is configured with hosted Supabase Auth for the **Maintenance** project in Sarthak Markad’s organization (Mumbai). Public URL/key settings are stored only in ignored local environment files. Hosted Auth settings, rejection of invalid credentials/tokens, and a real successful browser sign-in have been exercised. The first user’s server-controlled Administrator membership retrieves WH-C through the real NestJS API; evidence and remaining limits are recorded in `docs/VERIFICATION.md`. Operational data remains in the isolated local PostgreSQL instance; Supabase-hosted database migration/grants are still pending. No application deployment occurred.

Production Excel **preview → validation → duplicate-safe commit → persisted dashboard totals** is implemented. Open [WH-C Production](http://localhost:3000/machines/WH-C/production), choose authentic/synthetic provenance, and use **Import workbook**. Inspect one monthly WH-C sheet, review exclusions, acknowledge source notes and import selected valid days. Operators/technicians/management cannot import. Saved daily controls are never added as extra output; repeat files cannot duplicate a saved date. See [production behavior and limits](docs/PRODUCTION-IMPORT.md).

Synthetic **hourly readings and trends** are implemented at [WH-C Process trends](http://localhost:3000/machines/WH-C/readings). Import the supplied workbook, review excluded rows and acknowledge the demonstration rules before saving. The page shows three separate parameter charts, gaps, statistics, retrospective review periods and source/receipt history. It never combines synthetic readings with authentic production or creates an automatic breakdown. See [reading behavior and limits](docs/PROCESS-READINGS.md).

Trusted local administrators can also load the supplied demo through the same service, using the restricted runtime connection and a verified existing Auth UUID:

```sh
npm run demo:readings -- <verified-Auth-user-UUID> Maintenance_Handoff/data/synthetic/WH-C_Synthetic_Process_Readings_14_Days.xlsx
# After reviewing the preview, explicitly commit:
npm run demo:readings -- <verified-Auth-user-UUID> Maintenance_Handoff/data/synthetic/WH-C_Synthetic_Process_Readings_14_Days.xlsx --commit --acknowledge-synthetic
```

The command rechecks active stored membership, import role and WH-C scope. CLI imports are identified as LOCAL_CLI in audit metadata; this is trusted local administration, not a hosted Supabase login claim. No alternative browser authentication is added. Retrying a fully imported dataset adds no observations.

Persistent **breakdown reporting and work orders** are implemented at [WH-C Work orders](http://localhost:3000/machines/WH-C/work-orders). Operators report; heads assign; assigned technicians submit repair findings and human RCA; heads approve or return; supervisors or heads close approved work. Original reports and earlier submissions stay in history. Your existing Administrator account can view these records and has no engineering action authority. At the user’s explicit request, the existing pilot identity now has all six server-granted role views under **Active role**. Administrator stays the default and cannot approve while that view is active. Independent-person approval acceptance still requires separate staff identities. See [workflow behavior and limits](docs/WORK-ORDERS.md).

The [WH-C Maintenance calendar](http://localhost:3000/machines/WH-C/calendar) supports daily/weekly/monthly plans, technician assignment, upcoming/due/overdue views, explicit planned work-order release, reasoned skips, pause/resume and in-app reminders. Select **Maintenance head** to create the first real plan; no company schedule is invented. Planned technician completion records performed work/time and keeps human review/closure, without fabricated breakdown RCA. Dates stay fixed as requested. Jobs run while the local API is running and catch up after restart. See [calendar rules and limits](docs/CALENDAR.md).

**Statistical patterns** now appear below the three charts on [WH-C Process trends](http://localhost:3000/machines/WH-C/readings). Sudden-change, sustained-shift and gradual-drift flags explain the prior baseline and supporting readings, with chart markers, filters and paging. Only the active Maintenance head view can retain an investigation/dismissal decision with a reason. Reviews preserve exact evidence. The head can explicitly open and assign an investigation from a retained review; the technician records findings/outcome, the head reviews, and the head/supervisor closes. Review history links current progress. Detection never creates a breakdown or work order automatically. See [policy, Python setup and limits](docs/STATISTICAL-PATTERNS.md).

**Maintenance performance** is available at [WH-C Maintenance performance](http://localhost:3000/machines/WH-C/performance). All six scoped roles can inspect workload, older backlog, created/closed activity, generated planned-task completion and investigation outcomes. The technician sees its own open-assignment count. Open source records for role-authorized action; the dashboard is read-only. See [definitions, workflow and role activities](docs/MAINTENANCE-PERFORMANCE.md).

The dashboard focuses on maintenance workflow performance. MTTR, MTBF and machine-availability cards are omitted at the owner’s request. Reported temperature/pressure ranges remain unverified and are not safe limits or normal bands. All 20 intended areas remain in scope.

**Private work-order attachments** are available under **Photos & documents** on each work-order detail page. The reporting operator can add evidence before assignment; the assigned technician can add it after starting work and before submission. JPEG/PNG/PDF files are limited to 5 MB each and 20 per order. All scoped roles can download; submitted evidence is frozen until return. Uploads, versioned history and audit save together in the private local PostgreSQL database. See [attachment permissions, storage and limits](docs/ATTACHMENTS.md).
