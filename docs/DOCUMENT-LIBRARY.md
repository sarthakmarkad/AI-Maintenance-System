# Private approved machine manuals and SOPs

Implemented for the WH-C pilot at `/machines/WH-C/documents`, linked from **Manuals & SOPs**. This is a human-controlled reference library, independent of work-order notifications and repair approval. No manuals/SOPs are seeded, and no operational documents were uploaded during implementation. WH-B stays reference-only; the WH-C model remains unknown. These are bounded pilot design choices, not reconstructed authoritative SRS requirements.

## Workflow and access

1. Active Administrator or Maintenance head uploads a PDF, title, type (manual/SOP) and revision description. A new logical reference begins with file v1 in **Draft · unapproved**. Files, descriptions and logical title/type are immutable; corrections use another file revision or a new logical reference.
2. The head/admin can download drafts and inspect their exact SHA-256, file sequence and immutable upload actor/role/time. Uploading another revision leaves the existing approval available to readers.
3. Only the **active Maintenance head** can explicitly approve a selected draft, supplying a 3–1,000-character review reason. The UI asks the head to download/review the file first. Approval atomically makes that file the single current approved reference and marks any previous approval obsolete through the retained event history. It does not validate a repair, confirm file authenticity or establish an engineering cause.
4. The head may withdraw the current approval with a required reason. Withdrawal removes the reference from reader views. It retains all file bytes, hashes, upload/approval/withdrawal evidence and **does not restore an older approval**. Previously approved/withdrawn files cannot be approved again; a new draft revision needs a new explicit review.

| Active role             | Current approved browse/download  | Draft and obsolete metadata/download | Upload new reference/revision | Approve/withdraw |
| ----------------------- | --------------------------------- | ------------------------------------ | ----------------------------- | ---------------- |
| Operator / Technician   | Yes, with explicit machine access | No                                   | No                            | No               |
| Supervisor / Management | Yes, within organization          | No                                   | No                            | No               |
| Administrator           | Yes, within organization          | Yes                                  | Yes                           | **No**           |
| Maintenance head        | Yes, within organization          | Yes                                  | Yes                           | Yes              |

**Historical visibility policy:** Only head/admin see unapproved drafts, superseded approvals and withdrawn references, including their complete history. Other scoped roles receive only the currently approved file, its original upload and its approval event. They cannot retrieve obsolete/draft bytes by guessing IDs. Records with no current approval are absent from their lists and return 404 on detail/download. Head/admin history clearly labels **Obsolete · superseded**, **Obsolete · withdrawn** and **Draft · unapproved**; downloads of non-current files receive an `UNAPPROVED-OR-OBSOLETE-` filename prefix in the UI.

The API reuses transactional trusted membership, selected-role grant, organization and WH-C machine checks for every query, mutation and download. A grant for a second role does not combine authority with the active role. In particular, Administrator is never an engineering approver. Revoked selected roles/memberships and removed Operator/Technician machine grants deny subsequent metadata and byte access. No identity bypass, new account, provider change, browser database policy or new role grant is introduced.

## Files, storage and bounds

- **PDF only**, non-empty, maximum **5 MiB** per file (UI: 5 MB). Generic/absent MIME is accepted only when extension and PDF envelope agree; other supplied MIME must be `application/pdf`.
- PDF header and terminal EOF envelope are checked. ZIP/archive uploads are rejected, including obvious embedded ZIP local/end signatures; nothing is unpacked or executed. This conservative byte check can reject a PDF containing coincidental ZIP signature bytes. It is not comprehensive polyglot detection, a full PDF parser, malware scanning or content disarm.
- Filename is NFKC-normalized/trimmed, at most 160 characters, with path separators, header/control and bidi formatting characters rejected by the shared attachment policy. Logical title is 3–160 characters and revision description/review reason 3–1,000, trimmed.
- Maximum **200 logical references per machine**, **100 immutable file versions per reference**. There is no deletion/retention cleanup workflow. The theoretical payload ceiling is 500 MiB per reference and approximately 98 GiB per fully populated machine; actual database/backup capacity and a smaller organization storage quota require operational planning before larger use.
- Browse supports title search, manual/SOP type, current/draft/withdrawn filters, and 20 references per page. Role visibility applies before counts/paging. Metadata queries explicitly select no file contents; only authenticated download reads bytes. History is bounded by the 100-file lifecycle (at most 300 events).
- Multipart: one file, at most six text fields/seven parts, 4 KiB per field; unknown fields are rejected. The existing shared API-process attachment gate bounds uploads to four total/two per identity. This is not a distributed quota.

File bytes are stored privately as PostgreSQL `bytea`, using the existing attachment approach. The logical reference, immutable files and immutable lifecycle events live in `maintenance.MachineDocument`, `MachineDocumentFile` and `MachineDocumentEvent`. There are no public links, storage paths, frontend secrets, filesystem upload assets or signed URL expiry windows. Downloads require current trusted access plus the displayed logical record version, use `application/octet-stream`, attachment disposition with a safe fallback/RFC 5987 filename, `nosniff`, `no-store` and sandbox CSP. The app never renders PDF content inline.

No original company workbook persistence changes. The subsequent [document assistant](DOCUMENT-AI.md) adds page-aware extraction, private pgvector embeddings and CommandCode GLM advisory Q&A for current approved revisions. Approval atomically queues indexing; uploaded drafts remain excluded. OCR, automatic diagnosis and work-order creation remain outside this library workflow.

## Persistence and concurrency

The logical title/type and file bytes/metadata cannot be updated/deleted. The logical record's aggregate `version` is the only mutable field. Each successful mutation increments it once (creation starts at 1); file sequence is separate and increments only on uploads. Every event retains file ID, aggregate revision, action, reason, actual trusted actor/name/active-role snapshot and receipt time. All UI times are explicitly displayed in IST; stored receipt instants are UTC/timestamptz. No authoring, effective, inspection or repair time is inferred from upload time.

Current approval and file statuses are derived from immutable events. The latest APPROVE/WITHDRAW event decides the current file; newer UPLOAD events cannot remove it. This yields one current approval without a mutable `approved` file flag. Supersession is evidenced by the later approval event rather than rewriting the original approval.

One transaction:

1. Rechecks trusted scope/role; takes a machine-scoped advisory lock for bounded creation limits, retries and lifecycle mutations.
2. Looks up the organization/machine/actor/request UUID. An exact normalized payload/file hash/active-role fingerprint retry returns the original document/file/revision receipt and adds no event/audit, even after later changes. Changed request-key reuse conflicts.
3. For a new request, checks upload/head authority, target/version, allowed draft/current transition and file/document caps. Existing references use an atomic version compare-and-update; stale competing uploads/approvals/withdrawals conflict.
4. Appends immutable file bytes when uploading, an immutable event and protected audit with the exact file metadata/hash and reason, atomically. Any failure rolls back version, file, event and audit, preserving the old current approval.

Composite organization/machine/document/file foreign keys prevent cross-machine/organization linkage; actors reference the same organization's trusted membership. SQL enforces byte count/hash, file number uniqueness/bounds, actor-role/action rules, event sequence and legal approval/withdrawal state. Triggers forbid file/event edits/deletes and logical metadata edits/deletes. Deferred checks require file upload evidence, an event for every aggregate revision and matching protected audit evidence before commit. Runtime grants allow only SELECT, INSERT on the three tables, and logical `version` UPDATE; no file/event update/delete.

The UI retains failed upload file/description/request identity, blocks stale mutations until explicit reload, refreshes the same logical revision target on reload, and never automatically retries approval against a newer version. Loading requests and active uploads/downloads are aborted on unmount. Session expiry follows the existing shared sign-in flow. The head controls require an explicit approval/withdrawal form and reason. Controls have labels, focus targets and responsive wrapping; current/draft/obsolete meanings use text as well as color.

## REST and integration

All routes require verified Auth and the existing `X-Workspace-Role` selected-grant enforcement:

- `GET /api/machines/:code/documents?q=&kind=ALL|MANUAL|SOP&status=ALL|CURRENT|DRAFT|WITHDRAWN&page=1`: role-filtered page, total, capabilities and limits.
- `GET /api/machines/:code/documents/:id`: visible metadata and permitted history.
- `POST /api/machines/:code/documents`: multipart `file`, UUID `requestId`, `version=0`, `title`, `kind`, `description`.
- `POST /api/machines/:code/documents/:id/versions`: same multipart fields, displayed aggregate `version`, and unchanged logical title/type.
- `POST /api/machines/:code/documents/:id/actions/approve|withdraw`: JSON UUID `requestId`, displayed integer `version`, UUID `fileId`, required `reason`.
- `GET /api/machines/:code/documents/:id/versions/:fileId/download?version=<displayed aggregate version>`: authenticated bytes only.

Mutations return `{documentId,fileId,revision,alreadyApplied}`. Exact retries return the original receipt, not a misleading current state; the UI reloads. Invalid payload/type is 400, missing/expired Auth 401, wrong role/revoked membership 403, inaccessible record/file 404, stale version/changed retry/invalid lifecycle/cap 409, oversize 413, concurrent upload gate 429, dependency failure 503. A reader requesting a now-obsolete version receives 404 rather than obsolete bytes; an otherwise readable record with a stale aggregate version receives 409.

Migration: **`202610240015_machine_document_library`**, integrated with notification migration 014. The combined Prisma schema, API registration, narrow grants and UI navigation are applied locally. `document-library-types.ts` uses generated OpenAPI 0.11.0 response aliases. Detail reads use one repeatable snapshot; downloads lock approval state and recheck trusted access after acquiring the lock. Access-denied/not-found responses clear cached document data and management drafts until successful reload.

## Verification — 24 October 2026

Integrated with work-order notifications and the existing application. The complete suite passed **63 unit/backend + 116 PostgreSQL integration + 214 desktop/mobile browser = 393 tests**, strict TypeScript, generated OpenAPI 0.11.0 and NestJS/Next.js production compilation. Document-specific tests include five unit, 12 real PostgreSQL HTTP/integration and 24 desktop/mobile browser cases.

Coverage includes all-six-role scope, hidden draft/obsolete metadata and bytes, trusted selected grants/revocation, immutable file/hash/history evidence, exact retry/concurrent approval/upload races, stale downloads, preserved current approval while uploading drafts, supersession/withdrawal, audit rollback, SQL guards/composite scope, invalid/oversized files, 100-version cap, filters/pagination, retained failed forms, explicit stale reload and expiry. Parent review added a database regression proving a reader revoked between initial scope and the locked read receives no bytes, and browser regressions proving access denial clears cached references/drafts before reload. Synthetic desktop/mobile screenshots were inspected with notifications present in the same shell.

Migration/grants are applied locally. Before/after fingerprints show all pre-existing operational records unchanged, and all three document tables are empty: no company or test manual/SOP was preloaded. Live API readiness and unauthenticated denial passed. The collaborative browser redirected to login without a hydration warning; authenticated live company-PDF and independent-staff acceptance are not claimed. Browser fixtures intercept Auth/API, and all mutation/security acceptance uses the isolated `_test` database. No original workbook, credential, role grant or read-only handoff was edited. No push, deployment or publication occurred. Hosted storage/database operation, backup/restore, scanning and deployed quotas remain separate acceptance work. Full evidence is in VERIFICATION.md.

## Document AI integration — 24 October 2026

Approval now queues an immutable file/profile for indexing. **Ask approved documents and check AI indexing status** opens the new assistant. The library approval/download rules remain unchanged; indexing failures do not reverse approval or make drafts searchable. See DOCUMENT-AI.md for provider disclosure, retries, scope, limits and live-provider acceptance status.

The pilot now indexes approved text locally through Ollama and sends only selected passages/questions to CommandCode GLM for answers/support checks. Existing approval/withdrawal and draft visibility rules are unchanged. See DOCUMENT-AI.md for the 26 October provider switch.
