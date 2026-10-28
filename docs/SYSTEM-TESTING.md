# System testing and persistence audit

The 28 October 2026 audit checks existing hosted records without creating company incidents. Writes for acceptance use a separate PostgreSQL database whose name ends `_test`. Tests exercise trusted application memberships, machine scope and independent operational roles; production has no identity bypass.

## Repeatable commands

Run from the repository root with private environment files configured:

```sh
npm run db:local
npm run typecheck
npm test
npm run test:db
npm run test:web -- --workers=2
npm run test:system
npm run db:audit
```

`db:local` starts only the configured local test database when operational persistence is hosted. Do not replace hosted connections with test connections or run destructive resets against them. `test:db` and `test:system` prepare/migrate/seed/grant the isolated database and fail without test URLs. The system server additionally requires owner/runtime connections to match host, port and database name. Synthetic fixture organizations remain in that isolated database for inspection.

Run `test:web`, `test:system`, and a build **sequentially**: their Next.js processes share `.next-test`. System acceptance reserves ports 3130/4301; ordinary browser fixtures use 3100 and intercepted API 4400. Main app ports 3000/4000 remain separate. Use `MAINTENANCE_BROWSER_TEST=1 npm run build` when preserving the running main development cache.

`db:audit` uses the restricted operational connection inside a repeatable-read, **READ ONLY** transaction. It emits aggregate results only to `.local/database-audit.json`; it does not export questions, names, document contents, bytes or credentials. It checks all maintenance tables, retained migration checksums, constraint/index validity, foreign-key orphans, Prisma unique selectors/nullability, production totals and committed imports, synthetic reading provenance/measurement alignment, work-order version/history/audit, archived-work blockers, reference revision history, chat versions/archive cutoffs, private file hashes, RAG chunk completeness/vector dimensions, private schema isolation and restricted runtime privileges. It returns a nonzero exit code for failed checks. It is an integrity check, not a backup/restore drill, load test or proof of semantic correctness of every stored sentence.

## Feature coverage

| Feature | Persistence / behavior verified | Main automated coverage |
| --- | --- | --- |
| Authentication and six roles | Live membership/grants, selected-role isolation, expired/revoked identity and cross-organization/machine denials | auth, role-provisioning, database and work-order tests; six distinct system identities |
| Registry and access | Registration retry receipt, editable metadata, scoped normalized photos, shared version, access revocation, archive/restore blockers and retained history | machines integration/UI; real metadata/photo saves and reloads |
| Production | Preview receipt/provenance, invalid selection exclusion, per-job rows and separate daily controls, transaction rollback, duplicate/concurrent retries, standard and explicitly mapped machine layouts | production and machine-imports integration/UI; hosted row/control reconciliation |
| Process trends and statistical reviews | Synthetic observation/time provenance, gaps, prior-only evidence, immutable head reviews, explicit investigation release | readings/anomalies/investigation unit, integration and UI suites |
| Work orders and evidence | Report/assign/start/submit/return/approve/close/cancel policies, CAS races, immutable event/audit, private bytes and stage restrictions | workflow, work-orders and attachment suites; real six-role system journey |
| Planned maintenance | Fixed IST anchors, duplicate-safe occurrences/reminders, explicit release, pause/skip and planned completion distinct from repair RCA | recurrence/calendar integration/UI; hosted plan/occurrence links |
| In-app handoffs | New report/assignment/submission/return, current actionability, role-scoped read receipts | notifications suites and real head/technician system inboxes |
| External email | Verified self-only opt-in, cutoff, durable payload/outbox, worker lease/retry/idempotency, suppression after access change and immutable delivery attempts | external-notifications unit/provider, DB and desktop/mobile suites; no real test message sent during this audit |
| Manuals and SOPs | Private bytes, immutable revisions, head approval/withdrawal, current revision survives draft uploads, scoped downloads | documents suites; real SOP upload/approval/reload and byte-identical operator download |
| Chat and document retrieval | General/document routing, source approval/scope rechecks, extraction/chunks/pgvector retrieval, history/retries/archive and provider failure atomicity | rag suites with deterministic providers, browser fixtures; hosted saved chunk/file/chat integrity |
| AI RCA | Evidence snapshot, actual assigned technician, persisted request/receipt, stale/revoked access, no silent operational edits or automatic approval | RCA policy/provider/service and DB/browser suites; live provider probe attempted separately |
| Reports/performance | Exact IST cohorts, cancellation semantics, scoped current aggregates, export version/fingerprint and protected audit | reports/performance integration/UI; real work-order PDF download |
| Landing, navigation and forms | Responsive views, popup focus/draft behavior, local illustrative loop and protected dashboard entry | full desktop/mobile Chromium regression; native preview landing inspection |

The full UI suite intercepts Auth/API responses and is complementary to database integration tests. The added `tests/system` journeys do **not** intercept API requests: they start NestJS against restricted `_test` persistence and reload saved records. Only external Supabase identity is replaced in this test-only harness. Email and AI calls are disabled there. Six independent browser contexts represent Operator, Technician, Maintenance head, Supervisor, Administrator and Management. The CI workflow now runs these journeys after its ordinary browser suite; remote CI execution has not been observed during this task. Browser artifacts contain synthetic fixtures and remain ignored under `.local`.

## Corrections discovered

1. `ProductionRow` falsely declared `(orgId,machineId)` unique in Prisma while PostgreSQL correctly had an ordinary index. Corrected the Prisma declaration, regenerated the client and added a contract test comparing every generated unique selector with migrated unique indexes. Existing production rows were already valid; no source row was rewritten.
2. `ProductionImport.committedDayKeys` was nullable in SQL despite its required list contract. Migration `202610280031_required_import_receipts` enforces NOT NULL and rejects null elements. Existing hosted receipts contained no invalid values. Isolated tests prove direct null writes are rejected. Hosted application followed an ignored consistent checkpoint; all 37 operational table counts/content hashes matched afterward. Only Prisma migration history changed.
3. Three initial browser failures exposed fixture synchronization/format assumptions: Playwright can set files on a disabled editor before initial loading resets it, and Chromium rejects datetime strings with zero seconds in this fill path. Tests now wait for the user-editable state and use normalized minute precision when seconds are zero. Application permissions were not loosened.

A subsequent full database run had one unexpected 401 in a concurrent document-upload test (206/207); its complete document suite passed 12/12 independently, and a fresh full run passed 207/207. No authentication change was made to hide the failure. This isolated transport/test failure was not reproduced as an application workflow defect and remains disclosed here.

## Live dependencies and limits

Live CommandCode chat and RCA probes each returned **HTTP 429** on this audit. Chat surfaced `AI_RATE_LIMITED`; RCA retained a failed receipt rather than a generated diagnosis. Successful live AI generation/retrieval was therefore **not verified today**, despite deterministic retrieval/persistence/error-path tests passing. Resolve the provider account/rate allowance and rerun `npm run test:ai:live` and `npm run test:rca:live` for acceptance. These commands may consume paid usage and are confined to `_test`; they send synthetic test content to the configured provider. Do not treat an earlier successful provider check as today's result.

An independent live local-embedding check passed for both document and query purposes: finite 768-dimensional model output was correctly padded to 1536 storage dimensions. It called only the loopback Ollama service and wrote no database records. This verifies the embedding service independently of the blocked cloud answer model.

Real Google/password sign-in and external email inbox delivery were not repeated. Previously configured owner-verified services remain unchanged. No new email was sent and no real operational incident, plan, reference approval, chat or test identity was created in hosted persistence. This audit does not certify every browser, real iOS/Android, accessibility with assistive technology, high concurrency capacity, disaster recovery, deployment or vendor uptime. Final executed counts and evidence are recorded in VERIFICATION.md.


## Staff management acceptance — 29 October 2026

The third `npm run test:system` journey uses an Auth-known test UUID with no application user/membership, creates an Administrator invitation through the real UI/API, accepts it as a distinct verified-email identity, and checks actual single-role/machine grants in PostgreSQL. It then deactivates/reactivates the person through Team and proves retained-session denial plus recovery under the same membership UUID after reload. Verified-contact lookup is doubled only inside `tests/system/server.mjs` alongside its existing identity verifier; no production bypass or provider API is used. All seven identities and their writes remain in the guarded isolated `_test` database.

`tests/browser/team.spec.ts` adds desktop/mobile contract cases for Admin-only management, invite drafts, explicit role/machine payloads, stale snapshots, extra-role replacement, sending/revocation confirmations, unavailable SMTP, confirmed/wrong-account joining, signup confirmation, generic recovery responses, actual SDK PKCE recovery routing, verified password updates and missing-session denial. Team HTTP/PostgreSQL tests cover live grants, race/replay/expiry/revocation, access-CAS conflict, audit rollback, history retention and runtime/browser privilege boundaries. Results and provider limits are recorded in VERIFICATION.md.
