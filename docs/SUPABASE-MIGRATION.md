# Move the existing Maintenance database to Supabase

Target project: `atfjdjliclqzzapetnrr` (the existing hosted Auth project). This is an owner-authorized database migration. The local application, document extraction, Python worker and Ollama service are separate from database hosting; moving PostgreSQL alone does not deploy those services.

## Transfer status — 26 October 2026; feature extensions — 27 October

**Transfer and backend cutover completed.** The private `maintenance` schema is now in Supabase PostgreSQL 17.11 with pgvector 0.8.2. All 31 tables/842 rows match the final paused-writer source snapshot by count and full-content digest, including thirteen vectors, private files, chats and immutable workflow/audit evidence. All 20 Prisma migration names/checksums match the repository; 31 application triggers, 22 functions and all validated constraints are retained. No other project schema was restored or reset.

Root `.env` now uses the session pooler at `aws-0-ap-south-1.pooler.supabase.com:5432/postgres`. `DATABASE_URL` authenticates as the restricted SQL role `maintenance_app_runtime` (the pooler login includes the project suffix); `DIRECT_URL` retains separate owner access. Existing `TEST_*` URLs remain isolated on local PostgreSQL. Hosted Auth identities and application memberships/grants were preserved. The app is still served locally at http://localhost:3000; no deployment occurred.

On 27 October, reviewed migrations 021/022 added five private email/RCA tables, bringing the schema to 36 tables and 22 completed migration records. The 30 pre-existing application tables (excluding migration metadata) still match the preserved archive by full content digest; the five new feature tables remained empty during acceptance. No operational subscription, email delivery or generated RCA was fabricated for testing. All thirteen existing vectors remain unchanged.

Checkpoint/rehearsal metadata is in ignored `.local/supabase-migration/latest.json`, with the final checkpoint at `.local/supabase-migration/checkpoint-JIjkrH`. It contains the custom archive, consistent-snapshot manifest, checksum, hosted manifest, restore logs, original backend environment and current hosted connection backup. Credentials/backups are mode 0600 in the private directory and must not enter Git. The one-time preparation/cutover scripts are guarded private artifacts, **not startup commands**. Do not rerun the transfer against the populated target.

## Inspect hosted vectors

Open the [existing Supabase project](https://supabase.com/dashboard/project/atfjdjliclqzzapetnrr), sign in as its authorized owner and select schema **maintenance** in Table Editor. `DocumentRagChunk` contains `text`, `page`, source identifiers and the `embedding` vector(1536); `DocumentRagIndex` holds profile/revision/readiness metadata. PDF bytes and operational photos remain in the private application tables rather than public Storage. The existing thirteen vectors were copied unchanged; native Nomic 768-dimensional values retain their zero padding to 1,536.

A bounded read-only SQL Editor query can display vectors:

```sql
SELECT id, "indexId", page, ordinal, text, embedding::text
FROM maintenance."DocumentRagChunk"
ORDER BY "indexId", ordinal
LIMIT 20;
```

Dashboard owner access is separate from application roles. `maintenance` is excluded from Data API exposure and has no schema/table/function access for `PUBLIC`, `anon`, `authenticated` or `service_role`. The browser continues through NestJS with verified Auth and trusted role/scope checks. A publishable-key Data API query for the private vectors returned 406 / PGRST106. The previous local vector viewer on port 5556 is stopped; use the hosted dashboard for current records.

## Verified connection and runtime behavior

The runtime uses exact-pinned `@prisma/adapter-pg` 6.19.3 and `pg` 8.23.1 with explicit Node TLS CA/hostname verification (`rejectUnauthorized:true`). A public project-root CA is retained at the private path configured by `SUPABASE_CA_CERT`; both hosted URLs reference it. The certificate was obtained from the official Supabase certificate location. No invalid-certificate mode is enabled. Pool limits are bounded (runtime five, owner two); every adapter session uses UTC so stored instants remain compatible with the existing explicit IST domain rules.

Runtime cannot edit role membership or stored vectors; narrow workflow column updates and insert/audit grants are retained from `infra/runtime-grants.sql`. The login has no superuser, role/database creation, replication or RLS-bypass privileges. Existing code continues to recheck trusted organization/machine/active-role access; no permission union or identity bypass was added.

Read-only service checks against hosted data passed for all six existing trusted role views: five work orders, two approved references and two ready indexes. Only Maintenance head can approve references; Administrator has no work-order engineering actions. A real local Nomic query embedding retrieved six current-approved hosted vector/lexical passages. No acceptance incident, document approval or chat was written into operational data. Readiness is healthy; the native browser redirects to login, so authenticated browser acceptance was not repeated during this cutover.

## Verified migration administration and future changes — 27 October

Direct remote connections from the macOS Prisma 6 native engine still reject the project's CA. The supported commands now resolve that issue through `scripts/prisma-admin.mjs`: **`npm run db:status` and `npm run db:migrate` are verified working against Supabase**. The wrapper starts a temporary ephemeral-port listener bound only to 127.0.0.1, negotiates PostgreSQL TLS to the original destination through `scripts/postgres-tls-bridge.mjs`, and verifies its CA/hostname with Node TLS. Native Prisma connects only to that local listener and continues to manage its own migration history/checksums. No invalid remote certificate acceptance, manual migration-history insertion, permanent proxy or public listener is used. The wrapper closes connections after the command or interruption. Local owner URLs still use native Prisma directly.

Five TLS-bridge regressions cover verified forwarding, original URL/schema/credential handling without logging, rejection of untrusted certificates, hostname mismatch, servers declining TLS and unsafe configuration. Native status inspected the original 20 migrations; native deploy then applied the two feature migrations through the bridge, and direct SQL verified all 22 retained checksums. A temporary experimental JavaScript schema-engine configuration that failed PostgreSQL metadata deserialization remains removed. Seed/provision/grant-role scripts continue to use the verified Node adapter.

For a future hosted change, preserve the existing Prisma migration history, rehearse the reviewed SQL in isolated `_test`, retain a private checkpoint and use `npm run db:migrate`, followed by `npm run db:grants` and `npm run db:status`. Inspect counts/evidence/permissions after application; do not rewrite already-applied migrations or use `migrate dev/reset` against operational data. The original data transfer itself required no new migration; feature additions 021/022 were deployed separately afterward.

The client-to-session-pooler connection validates its CA and hostname. `pg_stat_ssl` observed from the server reported `false` for the pooler's managed upstream connection; it does not describe the verified client TLS connection. This run does **not** claim verified encryption on every provider-internal hop or changed Supabase SSL-enforcement settings. Direct database DNS was unavailable from this Mac. Provider-side TLS enforcement/backup restore drills remain separate administrative acceptance work.

## Local tests, startup and rollback

Normal startup is `npm run dev`; it starts the API, web and local embedding helper against hosted persistence. No local PostgreSQL is required to browse the running app. For isolated database tests, `npm run db:local` now selects the matching local `_test` owner/runtime URLs when operational connections are hosted. It refuses remote, mismatched or non-test fallback URLs and leaves hosted environment settings unchanged. Then use `npm run test:db`. Keep all test incidents in `_test`.

The original local operational database and final archive are retained. Rollback requires stopping writers and comparing hosted changes since cutover before selecting/restoring a destination; switching back to the old snapshot after hosted writes would lose those changes. The checkpoint's `backend.env` records the old local connections; it also contains secrets, so inspect/edit it privately. Preserve the newly selected AI provider/model and other current settings when restoring only database connections. Restart the API after a deliberate connection change. Hosted ongoing backups/restore drills and app deployment are not completed by retaining this one-time checkpoint.

## Original transfer procedure — retained for reference

The following steps describe the completed sequence. Existing pilot startup does not require them.

### Configure owner access privately

1. Open the project's Connect window. Select **Direct — Connection string**, then choose **Session pooler** as the connection method (port 5432). The Framework tab supplies browser/API configuration already used for Auth; it does not supply the PostgreSQL migration connection.
2. Save that PostgreSQL URI privately in root `.env` as `SUPABASE_MIGRATION_URL`. Replace its password placeholder locally; URI-encode special password characters. Keep `DATABASE_URL`, `DIRECT_URL`, frontend settings and existing test URLs unchanged until cutover.
3. If certificate verification needs the project's CA, download it through Database settings → SSL Configuration, retain it privately and set `SUPABASE_CA_CERT` to its absolute path. Do not disable certificate verification to pass a connection check.
4. The read-only preflight is `node .local/supabase-migration/preflight.mjs`. It restricts the target project/owner/database and port, uses verified TLS, inspects existing custom tables/vector support and changes no data. Its default trust store is `/etc/ssl/cert.pem`; the explicit project CA overrides that. Reachability and explicit CA acceptance passed before this transfer.

### Transfer and validation sequence

- Inspect the target's existing `maintenance` schema and permissions before writing. Refuse to overwrite an existing application installation; do not reset the Supabase project or copy over its `auth`, `storage`, `public` or platform-managed schemas.
- Pause the local application's writers/workers for final cutover. Take a fresh consistent private snapshot and manifest after the pause. The preparation snapshot is a rehearsal, not a promise that later local writes are included.
- Ensure pgvector exists in `extensions`; inspect an existing installation rather than moving/recreating it blindly. Do not change embedding profiles or regenerate vectors as part of the database transfer.
- Restore only the private `maintenance` schema, its retained data and Prisma migration history, using no source owner/ACL and one fail-fast transaction. The full restore orders source data before application triggers and foreign keys. Do not migrate schema first then disable evidence triggers to force data into immutable tables.
- Establish a separate, restricted database runtime login. Keep schema access private from `PUBLIC`, `anon`, `authenticated` and `service_role`; the browser continues through authenticated NestJS, not Data API table grants. Do not add `maintenance` to exposed API schemas. Apply the reviewed narrow grants in `infra/runtime-grants.sql`, retain the owner connection for migrations only, and use verified TLS for administration and strict-certificate TLS for Prisma.
- Compare every restored table's count/content digest with the final source snapshot, including file bytes, chats, vector text and migration history. Check constraints/triggers/functions and narrow privileges. Verify stored user UUIDs against this project's existing Auth identities without creating replacement users or changing their passwords/roles.
- Only after validation, replace root `DATABASE_URL` with the restricted runtime connection and `DIRECT_URL` with the hosted owner/migration connection, keeping schema `maintenance`. Use small explicit connection pools appropriate to the selected backend/pooler. Preserve all `_test` connections as separate local test databases.
- Restart the project API to load the new environment; verify readiness, real existing-role scoped reads, current references/vector search, files and work orders. Do not seed invented incidents or chats into hosted operational data for acceptance. Preserve the local database/checkpoint for rollback. Once hosted writes begin, returning to an old local snapshot would require reconciling those writes, not simply changing a URL.
- The hosted tables can be inspected through Supabase's Table Editor/SQL Editor under schema `maintenance`, within the owner's dashboard authority. Document actual hosted results and limits in VERIFICATION.md. Keep the local-only inspection viewer's old snapshot clearly separate or stop it after cutover.

## Connection tooling correction

The runtime grants CLI now preserves TLS/certificate parameters through libpq environment settings and strips only Supabase pooler project suffixes when choosing the actual SQL role. The complete pooler username is still used for authentication. Prisma-style `sslmode=require&sslaccept=strict` maps to libpq `verify-full`. Remote plaintext/opportunistic TLS is rejected; malformed URL errors omit secret input. Local grants and encoded credentials remain supported. Seven script regressions cover these paths and the isolated local bootstrap, with three additional backend adapter regressions. No credentials are passed as shell command arguments.

References: [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Prisma integration](https://supabase.com/docs/guides/database/prisma), [pgvector](https://supabase.com/docs/guides/database/extensions/pgvector), [SSL verification](https://supabase.com/docs/guides/platform/ssl-enforcement), [Prisma 6 TLS settings](https://www.prisma.io/docs/orm/v6/overview/databases/postgresql).

## Registry and current-photo extension — 28 October 2026

Hosted migrations 023–026 are applied, bringing maintenance to **26 completed migrations / 37 tables** including migration history. Migration 026 adds private MachinePhoto; runtime grants narrowly permit the five editable machine metadata fields and current-photo INSERT/DELETE, with no code/identity, role-grant, audit or photo-byte UPDATE permission. Browser roles remain outside the private schema. The content checkpoint before 026 matched all 35 existing operational tables afterward, and six real trusted role views passed read-only registry/details checks. No operational photo or metadata edit was invented for acceptance. Normal startup remains `npm run dev`; do not repeat the transfer or seed hosted data. Final evidence: VERIFICATION.md and MACHINE-EDITING.md.


## Lifecycle migration — 28 October 2026

Applied migrations 027–030 after isolated validation and a private consistent checkpoint. Hosted history now contains 30 completed matching migrations and 38 tables including migration history. All 36 pre-existing operational tables retained their row counts and original-column content digests. New lifecycle columns are nullable; no operational machine/order/chat was archived or cancelled for acceptance. Re-applied narrow runtime grants and verified all six existing trusted-role reads, private schema isolation, archive-column UPDATE and chat-receipt INSERT without machine or receipt DELETE. Read-only verification is retained under ignored .local/removal-* evidence.

## Persistence audit constraint correction — 28 October 2026

Migration `202610280031_required_import_receipts` was rehearsed in `_test`, then applied through the verified migration wrapper after a private consistent checkpoint. It enforces required import receipt arrays and rejects null elements, with no UPDATE/backfill. All **37 existing operational tables** retained their row counts/content hashes; migration history now contains **31** matching completed migrations, and the table total remains **38 including history**. Grants are unchanged because no new tables/columns/operations were added. The final read-only integrity audit passes 23 checks / 68 foreign keys, and all six real trusted role registry/details reads pass. New evidence stays under ignored `.local/audit-*`; do not repeat the one-time database transfer.
