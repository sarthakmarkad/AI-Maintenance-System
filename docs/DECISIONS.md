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

## Statistical pattern review — milestone 6, 18 October 2026

Implemented a separate standard-library Python worker behind the existing NestJS REST/auth boundary. A bounded isolated subprocess provides a local process boundary without a new exposed service, database credentials or a remote provider; this is not a deployed FastAPI service. Python 3.9+ on PATH and retaining the services/statistics source alongside the API build are now required.

Policy synthetic-rolling-mad-v1 uses 24 strictly earlier consecutive baseline hours, robust median/MAD scaling and explicit demo floors. One-hour change, three-sample same-side shift and six-sample directional drift have deterministic strict thresholds. Thirty-hour lookback preserves endpoint evidence across date filters; missing observations invalidate windows. Rules/limits are pilot choices documented in STATISTICAL-PATTERNS.md, not authoritative engineering settings or validated detection accuracy.

Flags are calculated on demand. Only head review decisions are persisted, keyed by policy and immutable reading evidence. One final decision per scoped key, stable exact retries, concurrent-decision conflicts, full evidence snapshots and atomic audit avoid mutable or browser-authored engineering history. No incident, schedule, notification, downtime cause or AI diagnosis is generated from these flags. Existing production/readings/roles/workflow/calendar records are preserved.

## Investigation workflow review — 22 October 2026

Statistical review and investigation release are separate explicit head actions in the UI. A retained INVESTIGATE review can be assigned later, including from historical evidence without re-running the worker. The earlier combined review/assignment API remains compatible when a head explicitly supplies a technician. Dismissals cannot open work. One scoped review links to at most one investigation; serialized release/retry checks compare the immutable opening fingerprint rather than the current, reassignable technician. Reviews stay immutable and progress comes from the linked work order.

Investigations retain the existing assigned technician → head review/return → head/supervisor closure flow. New submissions require a human-selected outcome (maintenance required, sensor check required, operating change explained, no fault found or inconclusive), findings, work/checks performed and an independent completion time. Maintenance/sensor outcomes require explicit next steps in the existing follow-up field. Approval/closure covers the investigation only; additional repairs require separate authorized follow-up. No automatic breakdown, restoration or causal RCA is inferred. These outcomes are pilot design choices, not reconstructed SRS requirements. Existing submissions are preserved without inventing retrospective outcomes; new submissions/resubmissions must provide them.

## Maintenance workflow performance — milestone 7, 22 October 2026

Added read-only machine-scoped performance for all six existing role views using current work orders, immutable START history and generated calendar occurrences. Date-selected creation records, independently date-selected closures and all-date current backlog have separate denominators. Mean/median clock-hour intervals stay separate by work type and disclose missing/invalid samples. First response uses immutable history so reassignment cannot erase it. Technician's personal count is server-derived; no new engineering rights or personal-only read restriction is introduced.

Planned closure/on-time percentages use due tasks through refresh time, exclude reasoned skips, include still-open eligible tasks and measure closedAt against fixed dueAt. Physical performedAt remains independent. Percentages are unavailable for empty denominators or incomplete/failed scheduling, which also warns that current overdue counts can be partial. Investigation outcomes distinguish provisional submissions from approved/closed findings and cannot establish repair completion or authentic production loss. These are documented pilot reporting choices, not authoritative SRS definitions. MTTR/MTBF/availability remain unavailable until downtime/runtime definitions and evidence exist. No schema migration, new grants, runtime identity bypass, dashboard writes, deployment or production-data change is needed.

## Reliability placeholder removal — 23 October 2026

The owner requested removing the unnecessary MTTR/MTBF feature after discussing its unavailable status. Removed the entire unavailable equipment-reliability section (MTTR, MTBF and machine availability), its response field/DTO and unused styles. Retained the maintenance performance dashboard, workflow timings, planned-task metrics and investigation outcomes. Existing missing-data handling within implemented measures remains unchanged. No stored data, role authority or workflow changed.

## Workflow timing removal — 23 October 2026

At the owner's request, removed the confusing Workflow timing section from Maintenance performance along with the unused timing aggregates, history query and API DTO fields. Backlog age, work-order timestamps/history, role permissions, activity counts, planned-task closure and investigation outcomes remain intact. No operational workflow or stored evidence changed.

## Private work-order evidence — milestone 8, 23 October 2026

Added bounded JPEG/PNG/PDF attachments, retained as private PostgreSQL bytea with immutable actor/stage/version/hash metadata. Chose the current private operational database for the local pilot so file, event, version and audit commit atomically without additional hosted credentials or a runtime filesystem store. Private object storage/scanning/retention/restore acceptance remains separate deployed work; original workbook retention is unchanged. This supersedes any general implication that every file feature must first introduce Supabase Storage, while preserving private storage and the existing workbook-specific deferral.

Reporting operator adds evidence before assignment; assigned technician adds it during IN_PROGRESS. Submitted evidence freezes for engineering review; head return reopens technician additions. Heads/supervisors/management/admin read/download within existing scope. Uploads advance the shared version without modifying workflow evidence; exact retry fingerprints, capped counts, scoped relations, immutable ATTACH history, audit and deferred SQL evidence checks protect the handoff. All six role permissions and independent timing rules remain intact. Limits (5 MiB/file, 20/order) and supported formats are pilot decisions, not reconstructed SRS requirements. See ATTACHMENTS.md. No public storage, Auth bypass, new identity, automatic diagnosis or deployment was added.

## Maintenance reports and exports — milestone 9, 23 October 2026

Added bounded read-only work-order/planned-task/investigation report previews and backend-generated PDF/Excel downloads, plus full-history individual reports. Date cohorts select created, independently closed or fixed due dates; stages/findings remain current rather than fabricated historical reconstructions. Planned reports retain unreleased/skipped/paused obligations, separate occurrence-snapshot/current technicians, warn about failed/catching-up/future generation gaps, and use closure independently of performed time. Synthetic investigation provenance and provisional human findings remain explicit. Removed reliability/timing features are not restored.

A repeatable-read source snapshot/fingerprint prevents previews silently exporting changed data; individual downloads require the displayed version. Post-render access checks and protected generation audit complete before bytes are delivered. No report data is accepted from the browser, no public file storage or Auth bypass is added, and no migration/grant expansion is required. ExcelJS writes literal strings, not user-authored formulas. PDFKit/fontkit and bundled OFL Noto fonts provide wrapped/paginated private reports with Latin/Devanagari text. Export limits (500 records/events, 100 pages, 16 MiB) and interactive generation gates are pilot choices, not reconstructed SRS requirements. The live pilot and operational records stay local; hosted deployment, independent staff acceptance and large archival exports remain separate. See REPORTS.md.

## Work-order handoff notifications — milestone 10, 24 October 2026

Used existing immutable committed WorkOrderEvent history as the durable source for actionable assignment/release, submission and return notifications, rather than a second delivery event stream. Only the latest workflow handoff for the current stage/recipient appears; ATTACH preserves a handoff. Retained historical events can appear unread if still actionable, without fabricating a delivery time or backfill. Append-only receipt/audit writes are unique by event, actual user and active role, serialize against workflow updates and leave work-order versions unchanged. Calendar reminders remain separate. No external messaging, new grants or automatic incidents are added. See WORK-ORDER-NOTIFICATIONS.md.

## Approved machine references — milestone 11, 24 October 2026

Added a bounded private PDF-only manual/SOP library using existing private PostgreSQL storage. Logical references retain immutable file revisions and append-only upload/approval/withdrawal evidence/audit; aggregate versions, scoped locks and exact retry fingerprints protect concurrency. Administrator/head may upload drafts, while only head approves or withdraws. One current approval is derived from lifecycle history; draft upload preserves it, replacement supersedes it, and withdrawal never restores an older approval. Other scoped roles see only current approved metadata/bytes; obsolete/draft evidence stays restricted to head/admin. Downloads lock approval state and recheck live access after acquiring that lock. No company documents, AI retrieval, hosted storage, accounts or role grants are seeded. Limits and approval policy are pilot choices, not reconstructed SRS requirements. See DOCUMENT-LIBRARY.md.

## New-breakdown notification handoff correction — 24 October 2026

The owner reported that a newly created high-temperature breakdown did not notify the Maintenance head. The initial notification policy omitted REPORT events. Added head intake notifications for committed BREAKDOWN reports still awaiting assignment, including retained pre-correction reports. Kept actionable-stage filtering, per-role reads, attachment-only evidence preservation and removal on successful assignment. Extended SQL read-receipt eligibility through a new corrective migration rather than changing applied history. Original reports and work-order workflow authority remain unchanged.

## Evidence photo previews — 24 October 2026

At the owner's request, added View beside Download for retained JPEG/PNG work-order evidence. The in-app native dialog fetches the existing authenticated download endpoint and renders a temporary raster image blob, avoiding a disk download. Download headers, private scope, original bytes, evidence/history and stage permissions remain unchanged. Object URLs are revoked and pending fetches aborted on close/retry/unmount; keyboard focus, loading/retry/decode errors and existing auth expiry are handled. PDF files remain download-only; no active document frame, public/signed URL or new API is needed. This supersedes the earlier photo download-only UI decision without changing private persistence.

## Approved-document RAG — milestone 12, 24 October 2026

Selected PostgreSQL/pgvector alongside the existing private library so organization/machine, file revision and current approval checks stay relational. OpenAI was selected after the owner delegated provider choice and authorized cloud processing. Approval queues indexing; uploads alone do not. Page-aware Poppler extraction, model/dimension/chunker profiles, leased duplicate-safe jobs, immutable complete indexes and transactional audit retain evidence. Exact scoped vector/lexical retrieval is suitable for this pilot; ANN scaling is deferred. All scoped roles can ask, only head/admin retry indexing, and only the head can approve references. Structured cited answers, exact-quote/numeric checks and a separate model support check can abstain; these are risk reductions, not guarantees of accuracy or prompt-injection resistance. No operating limit, fault or work order is generated authoritatively. Live tiny-fixture provider checks return 429; live model quality/access remains unverified. See DOCUMENT-AI.md.


## CommandCode GLM and local embeddings — 26 October 2026

At the owner's request, replaced the configured pilot's OpenAI dependency with CommandCode `z-ai/glm-5.3-flash` generation/support and local Ollama `nomic-embed-text:v1.5` embeddings. Explicit provider selection never silently falls back to another credential. Verified strict JSON and required CommandCode ZDR routing through real calls. GLM has forced thinking; output budgets constrain total generation but do not eliminate reasoning tokens.

Retained existing immutable 1536-dimensional storage through zero padding of native 768-dimensional Nomic vectors, which preserves cosine comparison within that profile. Digest/task-prefixed profiles prevent mixing old OpenAI vectors and make reindexing approved references duplicate-safe. This avoids rewriting retained evidence or an unnecessary schema migration. Local service digest checks, fixed loopback, no cloud authorization headers, no silent text truncation and managed project startup preserve boundaries. Existing library/work-order/role authority remains unchanged. Live acceptance uses only isolated `_test` synthetic fixtures; no operational sample upload/approval is fabricated. See DOCUMENT-AI.md and VERIFICATION.md.


## Conversational document assistant — 26 October 2026

At the owner's request, replaced the single-question document page with a dedicated chatbot using saved private threads, follow-up context, starter suggestions and compact source/Knowledge drawers. Current approved-document retrieval, GLM support checks and existing roles remain the authority boundary. Prior conversation is bounded untrusted context, never source evidence. Each new reply retrieves and checks current passages; saved replies whose approvals change are redacted on read.

Chose PostgreSQL DocumentChat/DocumentChatTurn tables beside the private source/index store so version, append-only turns and audit commit atomically. Scope is organization/machine/user/active role, including separate history for the multi-role pilot. No browser-owned history, identity bypass, external chat service or dependency is added. Raw questions and checked replies are now retained privately, superseding the earlier stateless answer design. No expiry/delete/rename is provided in this pilot; retention/backup policy is future work. Request fingerprints prevent duplicate saved turns and repeat calls after a committed receipt; simultaneous cross-instance requests can still make redundant provider calls before a stale-version conflict. Migrations 018/019 add constraints and correct the UUID-to-audit-text comparison without rewriting operational history.


## Selective retrieval and general conversation — 26 October 2026

The owner reported that “hiii” returned insufficient evidence and “hii what question can u anser” unnecessarily cited the SOP. Read the owner's retained two-turn conversation to confirm both failures. Replaced the document-only default and narrow exact-greeting shortcut with a GLM conversation/routing response: general questions answer directly, while local SOP/manual/equipment questions use approved-document retrieval. Explicit local-reference requests skip the routing call. Generic SOP definitions and ordinary writing remain general. Follow-up context retains each turn's mode and bounded prior text; a new general topic can leave document mode. Source changes still redact prior evidence, and document failure never falls back to invented site guidance.

Added GENERAL_ANSWER to the response contract and saved JSON, with a visible General knowledge label and no source controls. Chat is enabled with no ready corpus, independent of embedding availability. Existing role, approval, audit, idempotency and per-process model-attempt limits remain enforced. General replies use model knowledge and are not source-verified or web-current; they do not acquire engineering authority, live operational-data tools or record-writing capabilities. No schema migration or stored-message rewrite is required. This supersedes the earlier all-questions-RAG and static-greeting behavior. The legacy /ask endpoint stays document-only.


## Chatbot summary reliability and evaluation — 26 October 2026

The owner's newer chat could describe a reference, then refused requests to list/summarize its instructions. Read-only diagnosis found all three source chunks had been retrieved, reproduced output truncation, and found model-generated ellipses replacing blank form fields inside supposedly exact quotes. A five-statement cap could not naturally express the sample's six steps plus qualifications. Increased bounded summary capacity to twelve statements/6,144 output tokens, kept normal/general budgets separate, and instructed contiguous verbatim quotes. In summaries only, individually invalid statements can be omitted with visible disclosure, followed by the same semantic check on the retained set. Operational numbers remain strictly checked; list numbering is presentation.

Short selected references now supply all indexed passages in order, up to eight, rather than a three-passage-per-document sample. Longer references disclose excerpt coverage. Multiple/unknown references prompt clarification; trusted stored source IDs maintain the selected reference across follow-ups. Library inventory is computed from scoped approved metadata rather than model inference, with type filters and withdrawal-aware history. Safe reason codes distinguish failed generation/verification from absent source evidence.

Real stress cases also encountered provider timeouts/incomplete outputs. Added an explicitly labeled verbatim-reference fallback for summary failures, retaining source/access/audit checks and original provider reason without another paid attempt. This is not reported as a successful generated summary. General questions remain general, and missing machine-specific facts are never filled in from general knowledge. These changes require no migration, grant expansion, role change or operational-data rewrite. Added a finite real-provider evaluation matrix and deterministic coverage/failure regressions; observed evidence and limits belong in VERIFICATION.md.

## Immediate chat submission and server-owned quotations — 26 October 2026

The owner reported a composer that cleared only when the answer arrived. Clear it at submission, retain the pending question separately, and protect drafts typed during the request. Explicit retries use the original question/payload/request UUID independently of the next draft. On failure restore the sent text only if no composer edits occurred, while retaining a retry control. A synchronous guard prevents repeated Enter events from starting duplicate calls.

The latest retained summary had degraded to raw reference text after invalid model citations, and logs also contained failed provider requests. Replaced model-authored quote strings with selection from a server-owned catalog of exact source substrings. Expand selected IDs before existing exact quote, numeric and semantic support checks; reject unknown/mismatched IDs. This reduces repeated quotation generation and prevents invented ellipses/blank-field substitutions without loosening answer validation. Policy v3 requires no schema change or reindexing. Existing chats remain immutable. Provider availability/output variability and the explicitly labeled fallback remain limitations.

## Readable chatbot answers — 26 October 2026

The owner clarified that the Maintenance chatbot replies needed proper formatting. Read-only inspection confirmed an installation overview was saved as one paragraph with seven inline numbered steps. Added safe Markdown presentation for general and cited replies, with deliberate typography, lists, tables/code, and citation controls per point. Raw HTML and images are excluded; links allow HTTP/HTTPS only. New general replies are prompted for appropriate structure, and a shared conservative formatter in the API client package separates complete inline sequences both before saving new general replies and when displaying/copying older replies. It preserves wording/values and skips already multiline/code content and ambiguous numbering. Existing operational chats remain immutable; no authority/retrieval/schema change is involved.

## Dependency audit remediation — 26 October 2026

The owner reported failed GitHub job 121570094991. All application checks had passed; `npm audit --audit-level=high` failed on three underlying advisories (body-parser, Multer and Zod), with NestJS also flagged through its Multer dependency. Updated exact pins to Multer 2.5.0 and Zod 4.6.7, pinned body-parser 2.4.0, and made NestJS platform-express use the same patched root Multer. Retained the current NestJS framework versions rather than accepting the audit tool's suggested downgrade. The audit step and severity threshold remain unchanged.

Adapted the production acknowledgement error option to Zod 4 and replaced the removed anomaly query `innerType()` call with the existing object shape. Paired/ordered dates, the 31-day maximum, strict unknown-field rejection, explicit import acknowledgement and duplicate/day-count limits remain enforced. Added a regression proving an oversized AI statement array is rejected before reading elements. No schema, role authority, operational record or provider configuration change is required. Subsequent audit evidence supersedes earlier entries that recorded four outstanding findings.


## DeepSeek chatbot model — 26 October 2026

At the owner's request, switched conversation, document answers and semantic support checks to CommandCode `deepseek/deepseek-v4.1-flash`, verified against the live model catalog and [official model page](https://commandcode.ai/models/deepseek-v4-1-flash). This is the requested Flash model; the separate Fast variant is not selected. The backend allowlist retains GLM only for explicit legacy configuration, with no automatic fallback. Updated the private local model setting, source default, example environment and model-aware live reports.

A real synthetic-document probe showed the provider could ignore the strict response-format hint, omit the required status and add an unrelated type field. Supply the same response schema in system instructions as well as the API format field; retain strict server validation, evidence IDs, exact quotes, numeric checks and independent support checking. Do not repair malformed output into a valid answer. Default reasoning also exhausted small phase budgets. DeepSeek requests use documented `reasoning_effort:low` and 4,096-token allowances for conversation/support, retaining bounded document budgets and existing timeouts. These are caps, not expected consumption or promises of accuracy; no automatic paid retry is added. [DeepSeek parameter reference](https://api-docs.deepseek.com/guides/thinking_mode/).

Local Nomic embeddings and their immutable pgvector profile remain identical, so no reindexing, schema migration or saved-message rewrite is needed. All test fixtures remain in the isolated `_test` database. Current live results and limits belong in VERIFICATION.md.

## Hosted operational persistence — 26 October 2026

At the owner's request, moved the private `maintenance` schema into the existing Supabase Auth project `atfjdjliclqzzapetnrr`. Kept the existing Prisma migration history, immutable evidence, file bytes, chats and embedding profiles rather than rebuilding them. A paused-writer final snapshot, isolated restore rehearsal and complete per-table content digests verified the transfer of 31 tables/842 rows and thirteen vectors. The app now uses a dedicated non-owner runtime login through the session pooler; owner credentials remain for trusted administration, and all browser/Data API roles remain excluded from the private schema. No application role, Auth identity or approval was created or changed.

Selected the first-party Prisma PostgreSQL driver adapter with explicit verified Node TLS because the macOS native Prisma engine rejected the project's CA. Connection fields are parsed explicitly so URI SSL flags cannot override certificate verification. Every adapter session is UTC; the first full test run exposed thirteen timestamp-related failures under the local server's IST default, and enforcing UTC resolved them without weakening domain assertions. Existing explicit IST calendar/source rules remain intact. Local bootstrap now uses only matching local `_test` connections when application persistence is hosted, preserving the old local snapshot and hosted settings.

The verified app/runtime and libpq administration paths did not initially establish working native Prisma hosted migrations on this Mac. An experimental schema-engine configuration failed metadata deserialization and was removed. The subsequent verified administration path is recorded below. Client-to-pooler CA/hostname verification passed; provider-internal TLS hops and ongoing hosted backup/restore drills remain separately unverified. The API/web, extraction/Python workers and Ollama still run locally. See SUPABASE-MIGRATION.md for current access, evidence, rollback and administrative limits. No deployment or new Git commit/push was performed.

## External email and advisory RCA drafting — 27 October 2026

Implemented the two independent features with the owner's requested two GPT-6.1 Sol/high-effort delegated agents, then integrated and verified them together. Existing in-app notifications remain independent. Email is explicit, self-only opt-in for a trusted Technician or Maintenance head, using the confirmed Supabase account address and a future-event enrollment cutoff. Current grants, machine scope, assignment, handoff stage and preferences are rechecked before delivery. The private durable outbox retains immutable payload/attempt/audit evidence, bounded retries, leases and provider idempotency. Resend acceptance is not inbox delivery; in-progress messages cannot be recalled. No historical backfill, auto-enrollment or arbitrary browser-provided recipient is allowed. The supplied key is saved privately; sending remains disabled pending deliberate activation and real-message acceptance.

RCA drafting is an explicit advisory action for the currently assigned Technician on an in-progress breakdown only. The server snapshots retained report/history evidence and explicitly labeled current unsubmitted human fields; it does not claim to inspect photos, live readings or manuals. DeepSeek returns unconfirmed hypotheses/checks/actions using known evidence IDs. Reservation and receipt audits, exact-request retries, live scope/version rechecks and bounded quotas protect persistence and paid attempts. The technician reviews, edits and explicitly applies suggestions; restoration stays manual. The existing human submission, head approval/return and supervisor/head closure workflow is unchanged. All scoped roles may read retained advisory history. No model output establishes a confirmed root cause or engineering approval.

Validated native Prisma administration through a temporary loopback bridge whose remote PostgreSQL connection requires project-CA and original-hostname verification before authentication bytes are forwarded. `db:status` and `db:migrate` use this path for remote administration, without disabling remote TLS or rewriting migration history. Native Prisma applied migrations 021/022, followed by narrow grants; all thirty prior application tables remained identical by complete content digest. Five new feature tables remain empty in operational acceptance. This supersedes the earlier native-migration limitation; managed provider-internal TLS and ongoing recovery drills remain separate limits.

## Work-order intake during transient Auth failures — 27 October 2026

After the owner's failed new-report attempt, server logs showed a POST 503 at 8,022 ms followed by a GET 503 at 8,002 ms, matching the Supabase identity-check deadline. Current database readiness and subsequent Auth probes passed. Added one bounded retry of the read-only `getUser` check for temporary transport/5xx failures, splitting the existing eight-second budget between two attempts. No protected write is replayed, identity is never cached or accepted from browser claims, invalid sessions still reject and rate limits no longer incorrectly force sign-out. Persistent outages remain a 503 with a retry instruction. Existing report-key idempotency and draft preservation remain unchanged.

## Public landing and unified interface — 27 October 2026

At the owner's request, replaced the root redirect with a public landing page and Dashboard entry into the existing protected `/machines` route. Used the supplied Timescale/Refero reference for a warm blueprint canvas, dark outlines, orange headline accents, chartreuse highlights and Geist/Geist Mono. Kept Supreme branding and wrote original product copy and a clearly conceptual machine diagram; no customer logos, invented production metrics or reference-site artwork were imported. Font files are self-hosted with the included SIL license, avoiding external font requests and build-time downloads.

Applied a shared interface system to the full existing platform: registry/overview, production/trends, work orders and evidence/RCA, calendar/performance/reports, document library, assistant and notifications. Grouped navigation by purpose and made mobile navigation collapsible, with current-page semantics, Escape/focus recovery and a website return path. Sign-in now has a return-to-website link. Existing trusted roles, authentication, API contracts, maintenance workflows and stored operational data remain unchanged. The new public page never loads operational records; Dashboard entry still requires authentication. See UI-REDESIGN.md for ownership and verification details. No publication/deployment is part of this redesign.

## UI-design MCP refinement — 27 October 2026

Used the owner's downloaded UI-design MCP through its actual documented stdio server and bundled skill. Live web-dashboard and component searches plus full-image reads informed a calmer operational layout, clearer list controls and focused page navigation. Kept the approved Timescale-inspired palette and local fonts. Research and source limitations are retained in DESIGN_RESEARCH.md; reference images/caches remain ignored and were not added to product assets.

Selected a small set of shadcn-style local primitives rather than overwriting the existing design system: Radix Dialog 1.3.1 and cmdk 1.1.1 are exact-pinned; Command/Dialog, shared form controls/skeletons and Button sizing follow the existing Slot/CVA/CSS conventions. The page finder navigates current-role destinations only, contains keyboard focus, restores focus on close and ignores its shortcut while editing another form or using another dialog. It never performs a maintenance action. Loaded-order search explicitly retains pagination scope/server totals and uses only already authorized records; a full-database search API is not introduced. Existing engineering workflow, role grants and Auth remain unchanged. No new operational data, approval, email, AI call, commit, push or deployment is required.


## Retain the previous frontend — 27 October 2026

The owner preferred the cleaner interface that preceded the MaintainX comparison. Removed the uncommitted blue theme, illustrative work-order preview and new dashboard overview, restoring the previous Timescale-inspired landing, asset-registry entry and sidebar. The earlier MCP/shadcn refinements, page finder, loaded-order search, authentication and operational features remain. No commit, push, deployment or database change was made for this rollback.


## Operational popup forms — 28 October 2026

The owner confirmed popup forms across operational pages. Moved report/workflow actions, maintenance plans and occurrence actions, private evidence/reference uploads and reviews, workbook import/review, statistical decisions/investigation assignment and self-only email preferences into a shared native modal. Search/filter/date controls, login and the chat composer retain their page context. The existing warm design remains.

Kept dialog contents mounted while closed to preserve uncontrolled values and file selections alongside existing controlled state and retry keys. No draft is written to browser storage. Added initial/return focus, explicit keyboard wrapping, background scroll locking and dismissal protection during saving. Errors appear in the open form; stale versions still need deliberate reload. Statistical evidence is accessible inside its review popup. No API contract, database, role authority, record state, provider configuration or sending behavior changes. See FORM-POPUPS.md.


## Organization machine registration — 28 October 2026

The owner explicitly expanded scope beyond one machine. WH-C remains the original validated workbook pilot and WH-B remains reference-only; other registered organization machines now use generic maintenance workflows. Administrator manages registration and machine access, independently of Maintenance-head engineering authority. Unknown manufacturer/model/department/location remain null rather than guessed. Registration metadata and code have no edit/delete endpoint in this milestone.

Use organization-unique uppercase codes, immutable registration retry keys/fingerprints, transactional audit, and versioned access changes with exact retry receipts. Existing Operators/Technicians (including explicit additional trusted grants) receive individual machine access; no automatic grants, new identities or role unions. Heads/Supervisors/Management/Admin retain their organization scope and existing action permissions. A machine can be prepared before staff access is granted.

Generalized WorkOrdersService.context, machine overview/sidebar notifications, new email payloads and AI RCA evidence; retained machine-ID scope across calendars, private documents/RAG, reports and evidence. Removed WH-C-only SQL notification checks without weakening actionable-event/recipient rules. Existing queued emails remain immutable. New-machine workbook routes explain that a validated format is required; production/readings parsers remain WH-C-only and synthetic provenance is unchanged. Registry adds server search/keyset paging; registration and access use the existing native popup patterns. No operational acceptance machines/incidents or paid-provider messages were created. See MACHINE-REGISTRY.md and VERIFICATION.md.

The isolated database test runner now caps parallel test files at four. Running all integration servers alongside both frontend servers/browser workers caused transient HTTP socket resets in the existing document-cap fixture; bounded concurrency keeps CI/local checks within the available connection/process budget. New registry HTTP tests also use one listening fixture server for their lifetime. The mobile scope test waits for the machine heading after navigation, avoiding a matching registry-card label before the destination is ready.


## Production and Process trends for every registered machine — 28 October 2026

The owner corrected the registry rollout: both tabs must exist on new machines too, and explicitly selected standard templates for now. Removed the navigation/detail hardcoded WH-C capability gate. Production/readings services now resolve the selected registered machine through existing organization/role/machine access scope; WH-B remains reference-only. Excel headings/Guide/row machine identifiers must match that selection, with no silent reassignment.

Added authenticated, importer-only blank template downloads. The compact production template uses nine original columns, kg units, one job/activity per row and independent daily controls; the original monthly layout remains valid. Retain real cell references, row grain, source segregation and immutable staged parser versions. The process template preserves the existing synthetic three-parameter demonstration contract and explicitly invented bands/shifts. No custom sensor columns, authentic process values or engineering limits are guessed. No schema/migration changes, operational seed records or provider calls are needed. See STANDARD-EXCEL-TEMPLATES.md and VERIFICATION.md.

## Explicit WHB production mapping — 28 October 2026

After inspecting the owner's supplied workbook, obtained explicit confirmation that registered WHB is its “W & H B M/C” machine and should receive live production imports. This supersedes the prior reference-only restriction for that confirmed registration, while the reserved WH-B code remains reference-only. Keep an explicit, versioned WHB mapping rather than stripping punctuation from all machine identities or changing company source headers. Its remarks are AT and its downtime extends through AS; retain original category labels and cell addresses. Preserve existing WH-C and compact standard imports. Unexpected extra columns and invalid blocks remain reviewable/excluded, not silently interpreted or repaired. See PRODUCTION-IMPORT.md.

## Product copy, editable machine presentation and landing video — 28 October 2026

The owner retained the existing yellow accent and requested three parallel tasks, each explicitly delegated to GPT 6.1 Sol at medium effort. Removed redundant/pilot/developer-facing copy without hiding synthetic provenance, real data gaps, source evidence, actionable errors or human approval boundaries. Source diagnostics move behind expandable details where appropriate. The public metadata now describes all registered machines.

Administrator owns registry metadata/current-photo changes, separately from engineering authority. Codes/IDs and operational evidence remain immutable. Use the existing version/CAS and machine-row serialization for metadata/photo/access changes, exact action-scoped retry receipts, live role rechecks and atomic audit. Current private photos are normalized bounded WebP rasters in PostgreSQL; original/replaced photo bytes are not retained as work-order evidence. Only the five metadata fields are newly updateable by runtime; codes, role grants, audit and photo-byte updates stay protected. Photo summaries in registry/detail reads avoid per-card metadata discovery. An explicit retry can refresh a concurrently replaced photo.

The connected tools expose image generation, not a text-to-video service. Delivered an honestly labeled AI-assisted MP4 using one original generated concept still and deterministic illustrative workflow scenes. It replaces the schematic in the existing landing hero, with local poster/captions, deferred loading, native controls, reduced-motion pause and fallback transcript. No private data, unimplemented feature, automatic engineering judgment or customer result is shown. No deployment/publication, live operational acceptance write or commit/push is included. Dedicated workflow/evidence docs are UI-CONTENT-CLEANUP.md, MACHINE-EDITING.md and LANDING-VIDEO.md.


## Continuous landing tour — 28 October 2026

The owner requested a more dynamic, broader feature tour without player controls. The silent illustrative MP4 autoplays and loops, with reduced-motion and playback-failure fallbacks. The storyboard covers supported feature groups and remains explicitly illustrative and AI-assisted.


## History-preserving removal — 28 October 2026

The owner explicitly chose preservation rather than a cascade purge. Administrator machine archive/restore requires resolved work, paused plans and explicitly handled generated tasks, preserves codes/grants/history and makes operational writes read only. Head cancellation covers every work kind before approval, retains evidence and independent timestamps, and is excluded from open/completed metrics and actionable handoffs. Own saved-chat removal uses an immutable receipt and the reply-save owner lock; archived threads cannot be revived by retries or in-flight generation. Existing pause/skip, withdrawal, photo removal, access revocation and personal email opt-out remain the other lifecycle controls. Details are in RECORD-REMOVAL.md.

## Persistence audit and real API acceptance — 28 October 2026

The owner requested testing of every feature and saved data. Keep hosted inspection read only, with synthetic acceptance writes confined to matching `_test` owner/runtime connections. Added a repeatable read-only integrity audit and separate real Nest/PostgreSQL browser harness with six independent test identities; only external Auth is doubled in test code, and AI/email are disabled in that harness. Corrected a false Prisma ProductionRow uniqueness declaration without changing its already-correct stored index, and migration 031 tightens required import-receipt arrays without a guessed backfill. Apply it after isolated validation and a private checkpoint. Tests compare generated unique selectors/nullability with migrated PostgreSQL. Live provider HTTP 429 remains a disclosed dependency failure, not a passing AI generation result. See SYSTEM-TESTING.md and VERIFICATION.md.


## Company-data Production workspace — 29 October 2026

The owner requested removing the developer-facing authentic/synthetic choice from Production. The UI now always reads and imports company production (AUTHENTIC), retaining date filters and explicit validated-day commits. Removed unused source-switch state and simplified import/page copy. Preserve separate synthetic backend scopes and original source labels instead of deleting/relabeling test history or mixing totals. Known synthetic uploads still fail company-data validation with a message that does not refer to the removed selector. Process trends and its existing synthetic contract are unchanged. No database migration or operational acceptance write is required.


## Individual staff identities and trusted team administration — 29 October 2026

The owner requested individual accounts, invitations, role/machine management, deactivation and recovery, and confirmed that no verified Resend sending domain is available yet. Preserve the original shared pilot identity/grants while adding Administrator-only Team management for real separate identities. Invitations assign one trusted role, expire after seven days and need explicit acceptance by a Supabase-verified UUID and confirmed matching email. A fragment-only signed link plus hash-only database storage supports private sharing; confirmed-email discovery supports OAuth/confirmation callbacks without persisting invitation tokens in browser storage. No Auth admin/service-role key, metadata-based permission or identity bypass is introduced.

Identity/membership tables remain directly read-only to runtime. Narrow private fixed-search-path functions serialize scoped Administrator changes, require CAS plus machine-access snapshots, and retain immutable receipts and atomic audit. Acceptance cannot replace an existing identity's membership or reactivate it. Deactivation denies subsequent application requests, retains history/assignments and needs explicit reactivation; head remains responsible for reassignment. Own access editing is disabled, and the last active Administrator is protected. Additional pilot grants require explicit replacement when editing another account; the owner’s pilot is not silently converted.

New password signup/recovery remain disabled until custom Supabase SMTP is configured and tested (`TEAM_PASSWORD_EMAIL_READY=false`). Existing confirmed password login and Google remain usable. Staff invitation sending is an explicit audited action, separately gated to a verified-domain Resend sender, bounded by receipt/cooldown limits; no automatic retry or delivery guarantee. The owner will configure the domain/SMTP using STAFF-MANAGEMENT.md. No real invitations, fake staff records or real messages are needed for automated acceptance.
