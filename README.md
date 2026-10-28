# Supreme Maintenance Intelligence

Machine maintenance workspaces for registered equipment within an organization. WH-C remains the original Windmöller & Hölscher blown-film pilot; its exact model is unknown. Administrators can now register other machines and grant operator/technician access. This repository implements authenticated access, production workbook import and dashboards, synthetic hourly trends, role-controlled maintenance work orders, fixed-date planned maintenance, explainable statistical review, maintenance performance, private evidence/reports, in-app and opt-in email handoffs, approved references with document chat, and human-reviewed AI RCA drafting. Operational persistence is hosted in Supabase; the application and embedding worker remain local. Every registered machine has Production and Process trends tabs, with downloadable standard Excel templates. Custom workbook mappings, other process parameters/units and telemetry integrations remain separate work. See [machine registration and access](docs/MACHINE-REGISTRY.md).

## Start here

The project lives at `~/Documents/Projects/Maintenance` (the filesystem also resolves the user's lowercase `projects` path). No code is built in the ChatGPT project mirror.

Prerequisites: Node 22.12–24, npm 11, Python 3.9+ available as `python3` on PATH. The configured pilot uses hosted Supabase PostgreSQL/pgvector. Document AI additionally needs Poppler (`pdfinfo` / `pdftotext`) plus local Ollama on the API host. Native PostgreSQL 16/pgvector remains available for isolated local tests; Docker is an alternative for a fresh local installation.

```sh
cd ~/Documents/Projects/Maintenance
npm ci
# Existing pilot: private backend/frontend environment files are already configured.
npm run dev
```

The existing hosted database is initialized: do not seed, restore or rerun the one-time transfer to start the app. For a **fresh local-only installation**, run `npm run db:local`, `npm run db:migrate`, `npm run db:seed` and `npm run db:grants` before development; copy `apps/web/.env.example` to `apps/web/.env.local` if absent and configure Auth. Hosted `db:migrate`/`db:status` now use the verified administrative TLS bridge described in [the migration runbook](docs/SUPABASE-MIGRATION.md).

- Frontend: http://localhost:3000
- The public landing page is at `/`. Its **Dashboard** entry opens `/machines`, with the existing sign-in boundary for signed-out visitors. The retained yellow theme now includes an original [50-second AI-assisted product walkthrough](docs/LANDING-VIDEO.md). Administrators can [edit machine details and private photos](docs/MACHINE-EDITING.md) from the registry or overview. See [the UI design notes](docs/UI-REDESIGN.md).
- Operational entry forms open as popups; drafts and file selections remain when closed and reopened on the same page. Search and filters stay inline. See [popup behavior](docs/FORM-POPUPS.md).
- Use `localhost` for the local pilot. Development requests to `127.0.0.1` redirect there when the API is configured for localhost, keeping authentication and API origin settings consistent.
- NestJS API: http://localhost:4000/api
- Swagger: http://localhost:4000/api/docs
- OpenAPI JSON: http://localhost:4000/api/openapi.json
- Liveness: `/api/health/live`; readiness: `/api/health/ready`

The retained native database uses **127.0.0.1:55432**, `.local/pgdata`, and its own credentials. It does not use the existing PostgreSQL instance on port 5432. With hosted app connections, `npm run db:local` starts only the separate local test database using `TEST_*` credentials; it does not replace hosted settings or update the old operational snapshot. Stop it with `npm run db:local:stop`. Preserve `.local/pgdata` and private migration checkpoints for rollback evidence.

For a fresh checkout, the API can start without Supabase credentials but fails closed: unauthenticated protected requests return 401, bearer requests cannot authenticate, and readiness returns 503. The login screen explains missing setup and disables sign-in. This is intentional; there is no mock/development login or runtime file store.

For repeatable persistence and user-workflow checks, see [system testing and database audit](docs/SYSTEM-TESTING.md). `npm run db:audit` checks hosted integrity read-only; `npm run test:system` runs real API/database browser journeys against the isolated test database.

## Connect actual Supabase authentication

1. Create/select an authorized Supabase project. Obtain its URL and **public publishable key** (or legacy anon key). Do not put a secret/service-role key in frontend configuration.
2. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in root `.env`.
3. Set the same URL/key as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `apps/web/.env.local`. `NEXT_PUBLIC_API_URL=http://localhost:4000/api`.
4. For a fresh organization's first Administrator, create/verify their Supabase Auth account using trusted administration and copy its actual UUID. Further staff join through **Team → Invite staff**; see [individual accounts and SMTP setup](docs/STAFF-MANAGEMENT.md). Auth signup alone cannot grant application privileges.
5. Provision a trusted application membership, e.g.:

```sh
npm run db:provision -- <actual-auth-user-uuid> OPERATOR "Display name" WH-C
```

Allowed roles: `OPERATOR`, `TECHNICIAN`, `MAINTENANCE_HEAD`, `SUPERVISOR`, `MANAGEMENT`, `ADMINISTRATOR`. Operators/technicians require an explicit machine grant. The CLI creates new memberships only and does not silently change existing roles. For explicitly approved multi-role pilot access on an existing identity, see [team access](docs/TEAM-ACCESS.md) and the separate trusted `db:grant-roles` command. It uses `DIRECT_URL` and writes membership/grants/audit atomically. The owner must verify the supplied UUID belongs to the intended Auth user.

6. Restart local development after environment changes; sign in and verify `/api/me` and `/api/machines/WH-C`. Complete the hosted acceptance checklist in `docs/VERIFICATION.md`.

Local PostgreSQL can be used with hosted Supabase Auth for development. The configured pilot now uses the existing hosted Supabase database as well as Auth; the application itself still runs on this computer.

## Google sign-in and role views

Administrators can invite individual staff, assign one role and machine access, and deactivate/reactivate accounts while preserving history. Google or an existing confirmed password account can accept a shared invitation now; new password signup/recovery require the documented custom SMTP setup. See [staff management](docs/STAFF-MANAGEMENT.md).

Email/password login supports every trusted application role. The existing pilot account now offers six individually enforced role views, without duplicate Auth users or shared permission unions. See [the role matrix and enforcement](docs/TEAM-ACCESS.md).

Google OAuth application code and tested PKCE callbacks are implemented. The owner has configured Google OAuth; hosted provider availability and the real redirect to Google were verified, and the owner reports checking the login. The button reads actual provider availability; existing email sign-in stays usable. Follow [the exact Google setup guide](docs/GOOGLE-SIGN-IN-SETUP.md). No Google client secret belongs in frontend settings.

## Database configuration

`DATABASE_URL` is the restricted runtime connection. Imports and maintenance workflows need the milestone-specific narrow grants; run `npm run db:grants` after migrations. `DIRECT_URL` is an owner/migration connection; keep it out of the running API environment in a deployed environment. Prisma migrations/seed/provisioning use owner credentials, not browser tokens. The private `maintenance` schema is not intended for exposure through Supabase Data API. The initial migration revokes public and existing Supabase browser/service role grants; no browser table policies or browser database access are used.

The configured Supabase project uses its session pooler on port 5432, a dedicated non-owner `maintenance_app_runtime` login, and a project CA with hostname/certificate verification. The Prisma PostgreSQL driver adapter uses a bounded pool and UTC sessions; domain IST handling is unchanged. Keep `maintenance` out of exposed schemas. Runtime permissions protect identities/role grants and immutable machine codes while narrowly permitting audited registry metadata/photo/access administration, imports and workflow/history writes. `anon`, `authenticated` and `service_role` have no access to the private schema. **Do not use the database owner as DATABASE_URL in production.** Hosted counts, content digests, grants, real-role scoped reads and vector retrieval were verified; see [migration evidence and administrative limits](docs/SUPABASE-MIGRATION.md).

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

Work-order photos/documents are retained privately in PostgreSQL with immutable metadata; see [attachment workflow and limits](docs/ATTACHMENTS.md). Production XLSX uploads are parsed in memory; source rows and reconciled daily records persist in PostgreSQL. Original file-byte storage is deferred to private Supabase Storage. Recharts renders saved quantities with gaps. A bounded NestJS calendar worker persists occurrence cursors and in-app reminders in PostgreSQL. A separate bounded Python process evaluates synthetic statistical patterns on demand, without database/provider credentials. The approved-document assistant adds private PostgreSQL/pgvector embeddings and backend-only CommandCode DeepSeek calls with local Ollama embeddings; no Redis queue is introduced. Future service directories will be added with their implementation.

## History-preserving removal

Administrators can archive and restore machines; Maintenance heads can cancel pre-approval work orders of every kind; users can remove their own saved conversations. Historical evidence remains retained. See [removal workflows and role permissions](docs/RECORD-REMOVAL.md).

## Current boundary and next milestone

The local app is configured with hosted Supabase Auth and operational PostgreSQL for the **Maintenance** project in Sarthak Markad’s organization (Mumbai). Public URL/key settings and private database/provider credentials stay in ignored environment files. Hosted Auth settings, rejection of invalid credentials/tokens, and a real successful browser sign-in were exercised earlier. The database cutover preserved all 31 tables/842 rows and 13 vectors, including existing identities, files, chats and immutable evidence. The six existing role views were checked read-only against hosted data; authenticated browser login was not repeated for this cutover. Evidence and remaining limits are recorded in `docs/VERIFICATION.md`. No application deployment occurred.

Production Excel **preview → validation → duplicate-safe commit → persisted dashboard totals** is implemented. Open [WH-C Production](http://localhost:3000/machines/WH-C/production), use company production automatically, and select **Import workbook**. Inspect one monthly WH-C sheet, review exclusions, acknowledge source notes and import selected valid days. Operators/technicians/management cannot import. Saved daily controls are never added as extra output; repeat files cannot duplicate a saved date. See [production behavior and limits](docs/PRODUCTION-IMPORT.md).

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

**Private work-order attachments** are available under **Photos & documents** on each work-order detail page. The reporting operator can add evidence before assignment; the assigned technician can add it after starting work and before submission. JPEG/PNG/PDF files are limited to 5 MB each and 20 per order. All scoped roles can preview JPEG/PNG photos in the app or download files; submitted evidence is frozen until return. Uploads, versioned history and audit save together in private PostgreSQL, now hosted in Supabase. See [attachment permissions, storage and limits](docs/ATTACHMENTS.md).

**Maintenance reports** are available at [WH-C Reports](http://localhost:3000/machines/WH-C/reports). Preview work-order, planned-maintenance and investigation registers with explicit IST dates, then download a PDF summary or full-current-field Excel workbook. Work-order detail also exports a complete-history PDF/Excel report and attachment manifest. All six roles use existing trusted scope; previews/versions guard stale downloads, and generated exports append protected audit. Keep `apps/api/assets/fonts` with packaged API builds. See [report definitions, workflow and limits](docs/REPORTS.md).

**Work-order notifications** appear above WH-C workspaces for the active Technician and Maintenance head views. Technicians see their own current assignments/releases and returned work; heads see unassigned operator breakdown reports and submissions awaiting review. Explicit role-specific read receipts do not change work orders. Calendar due-date reminders remain separate. See [handoff rules and limits](docs/WORK-ORDER-NOTIFICATIONS.md).

**Manuals & SOPs** is available at [WH-C approved references](http://localhost:3000/machines/WH-C/documents). Administrator or Maintenance head uploads private PDF drafts/revisions; only the head approves or withdraws references with a reason. Other scoped roles see only the current approved file. Uploading a draft preserves the existing approval; superseded/withdrawn evidence remains available to head/admin. No company manual is preloaded and no AI is added. See [document workflow and limits](docs/DOCUMENT-LIBRARY.md).

**AI assistant** at `/machines/WH-C/assistant` offers saved private conversations and follow-up questions. General questions receive ordinary AI replies; SOP/manual or local-equipment questions retrieve current approved PDF passages for cited advisory replies. General chat does not depend on ready documents. Starter suggestions, numbered source citations and a Knowledge drawer keep the conversation uncluttered. Approval queues page-aware indexing; drafts/withdrawn/obsolete revisions are excluded. All scoped roles can ask; head/admin can retry indexing. CommandCode/local embedding setup, billing/access limits and verification are documented in [DOCUMENT-AI.md](docs/DOCUMENT-AI.md). Model-specific live acceptance, local embeddings, citations, insufficient-evidence handling and withdrawal checks are recorded in docs/VERIFICATION.md.


Document AI first setup: install Ollama and Poppler (`brew install ollama poppler` on this Mac), then `npm run ai:setup` to download the local embedding model. `npm run dev` manages the local embedding service alongside API/web. The pilot uses backend `DOCUMENT_AI_PROVIDER=commandcode` and `COMMANDCODE_API_KEY` with `deepseek/deepseek-v4.1-flash`; no direct OpenAI credits are required. `npm run test:ai:live` is an explicit, potentially billed acceptance test confined to the isolated `_test` database. See [DOCUMENT-AI.md](docs/DOCUMENT-AI.md).

**Email alerts** are available for active Technician and Maintenance head views at `/machines/WH-C/notification-settings`. Each person opts in using their confirmed sign-in email; only new actionable handoffs after enrollment are eligible. The durable queue suppresses stale assignments/revoked access, records attempts and uses bounded provider-idempotent retries. Provider acceptance is separate from inbox delivery and from in-app read status. Sending stays off until the backend Resend sender/key and feature flag are configured; no real emails were sent during implementation. See [external email workflow and setup](docs/EXTERNAL-NOTIFICATIONS.md).

**AI-assisted RCA drafting** is optional inside the assigned technician's BREAKDOWN completion form after starting work. Generate from recorded work-order text/current human inputs, review attributed evidence and unconfirmed possibilities, edit suggestions and explicitly copy selected fields into the form. Service-restored time stays manual. Submit through the existing workflow; Maintenance head approves or returns the human report, and Supervisor/head closes it. All scoped readers can expand retained AI drafting evidence, which does not claim that submitted text is an unedited AI output. Planned work and investigations keep their existing completion forms. See [AI RCA workflow, permissions and limits](docs/AI-RCA-DRAFTING.md).
