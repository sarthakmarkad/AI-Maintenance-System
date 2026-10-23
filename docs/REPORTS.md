# Maintenance reports and exports — milestone 9

## Purpose and report types

**Maintenance reports** is a read-only machine page at `/machines/WH-C/reports`. Choose dates and filters, select **Preview report**, then download PDF or Excel. Downloaded files are generated privately by NestJS from saved PostgreSQL records; the browser cannot submit replacement report data.

| Report | Date basis | Contents |
|---|---|---|
| Work orders | Created date or closed date, inclusive IST calendar dates | Current stage/type/assignment and creation/closure register; Excel also includes current human findings/RCA/actions and independent times |
| Planned maintenance | Immutable fixed due date, including generated future tasks | Generated tasks, unreleased/assigned/work/review/closure stages, reasoned skips, planned snapshot and current assignee, independent performed/closed times |
| Investigation outcomes | Created date or closed date | Current human outcomes and stage, explicit synthetic provenance and retained source reviews/evidence in Excel |
| Individual work order | The currently displayed work-order version | Current report/findings/times, complete immutable action history, source review/evidence where applicable, and attachment manifest; PDF and Excel available on work-order detail |

The aggregate PDF is a register summary, not every order's full findings/history. Aggregate Excel contains current findings; use an individual work-order export for complete history. Exports do not add diagnoses, change state, create incidents, approve work or complete recommended follow-up repairs. Synthetic source readings cannot establish authentic fault causes or production-loss attribution. Removed MTTR/MTBF/availability and Workflow timing sections are not reintroduced.

## Workflow and role activity

1. Open a machine's **Maintenance reports** from the sidebar or machine overview.
2. Choose report type, From/To dates, status (All/Open/Closed), and, for the work-order register, work type. Created/closed reports cannot extend beyond today in IST; the default is the last 30 IST calendar dates. Planned reports default to today through the following 29 dates and may extend at most 365 days ahead. Any selected window spans at most 366 inclusive dates.
3. Apply filters with **Preview report**. Editing filters disables downloads until the new preview is loaded. The preview shows its date basis, generation instant, record count, coverage/provenance notes and source-record links.
4. Download PDF or Excel. If exported source data changed after preview, the API returns 409 and the page requires **Refresh preview**. It does not silently download a newer dataset.
5. For a single order, open work-order detail and choose **Download work order PDF/Excel**. The API requires that displayed version; stale versions follow the existing reload flow.

| Active role | Report activity |
|---|---|
| Operator | Export machine-granted reports and original report/history evidence; report observations through the existing work-order page |
| Technician | Export machine-granted reports, review assignments/history; perform assigned work through existing controls |
| Maintenance head | Export organization-scoped machine records for assignment/review follow-up; engineering authority stays in existing workflow endpoints |
| Supervisor | Export records for approved-work closure checks; cannot acquire engineering approval rights through reporting |
| Plant management | Export records for review and planning; no maintenance mutations |
| Administrator | Export authorized records; no engineering approval/repair authority |

All six roles use their existing read scope. Operators/technicians still need explicit machine access. A selected role must match an active trusted grant and never combines permissions. Same-account pilot role selection remains supported; independent real-person acceptance is separate.

## Definitions and coverage

- Created-date selection uses `reportedAt` (the creation time also used for planned/investigation orders). Closed-date selection uses `closedAt` independently, so an older-created order closed in the chosen dates is retained.
- Stages, assignments and findings are current at the captured database snapshot, **not reconstructed as of the historical end date**. Closure is terminal in the current workflow.
- Open means not CLOSED. For planned tasks it additionally excludes reasoned skips and includes unreleased tasks and every unfinished work-order stage, including APPROVED. Closed/complete means linked work order CLOSED; performed time alone does not mean closed or on time.
- Planned export retains paused-plan obligations and immutable occurrence snapshots. The current linked work-order technician is shown when reassigned; the planned snapshot technician is a separate Excel field. Closure timing compares closedAt with fixed dueAt, independently of performedAt.
- Only generated occurrences exist to report. Failed/catching-up schedule processing warns of potentially omitted due tasks; ungenerated future recurrences inside the requested window have a separate warning. No missing occurrence is invented and no unavailable coverage is presented as a complete plan history.
- Investigation outcomes in submitted/returned work are provisional; APPROVED/CLOSED states have current head approval. A legacy submitted investigation with no saved outcome says so. Approval/closure does not certify recommended repair completion.
- Individual history exports every event through the captured version, in ascending order, not only the latest UI page of 50. Earlier submissions, returns, assignments and attachment upload events remain distinct. Event actor names/roles come from immutable snapshots; current responsible-person names come from current trusted records.
- Attachment manifests retain filename, description, type, byte count, SHA-256, uploader/role, upload time and work-order version. File bytes are deliberately excluded from reports. Existing protected attachment downloads remain separate. Upload time is a receipt time, not an inferred photograph/inspection time.
- PDF and human-readable columns show IST with seconds; Excel also retains UTC ISO creation/closure times and event/review/upload timestamps. Missing times remain explicitly unrecorded rather than zero or copied from another stage.

## Consistency, access and audit

Every source read is one repeatable-read transaction with fresh trusted membership, selected-role and machine checks. Cross-organization same-code machines do not share rows. The complete export dataset, versions, filters, coverage notes and source identity produce a SHA-256 source fingerprint; generation time and requester metadata do not affect it. Preview returns at most 50 rows but hashes the entire bounded source dataset. Downloads include every matching row, not only the visible preview. Exact refreshes remain compatible; changed evidence/versions require a new preview. This is a source-consistency marker, not a digital signature or proof that an offline copy is unmodified.

Rendering occurs outside the database transaction. Access is rechecked after rendering and before delivery. A protected `REPORT_EXPORTED` audit event records the verified actor/role, machine, format, filters/date basis, count and source fingerprint; individual exports also retain the source order ID/version. Audit failure returns an error before any file bytes are sent; operational records are unchanged. The event proves authorized file generation, not successful client receipt. Preview requests do not write audit events.

Files use authenticated API requests, `Content-Disposition: attachment`, no-store, nosniff and sandbox CSP. No public/signed storage URLs, browser tokens in URLs, external document fetches, email delivery, or permanent report storage are introduced. No schema migration or additional runtime grants are needed; the existing protected audit INSERT grant is used. Operational/report data is not written to public assets or runtime files.

## File generation and limits

- Maximum **500 matching records** per aggregate report. Exceeding the limit returns 422 with narrowing guidance; there is no silent truncation.
- Preview displays the first **50** with an explicit all-record download count.
- Individual reports support **500 complete history events** and the existing 20-file attachment limit. Longer histories require a separately designed archival export, rather than an incomplete file.
- Maximum 4,000,000 serialized source-text characters, 100 PDF pages and 16 MiB per output. A single overlarge PDF row or Excel cell beyond 32,767 characters fails explicitly. These are bounded pilot choices, not authoritative SRS requirements.
- At most two concurrent file generations per API process, one per verified identity. The gate releases on completion/error/cancellation. It is not a distributed quota.
- Existing ExcelJS writes typed literal strings/numbers: user content is never accepted as a formula or hyperlink object, even if it starts with `=`, `+`, `-` or `@`. Zero values remain numbers. Unsupported XML control characters are represented visibly as `[U+XXXX]`.
- PDFKit produces wrapped, paginated documents with repeated table headings, page numbers and source markers. Bundled OFL-licensed Noto fonts support Latin and Devanagari, including mixed-language fields. Characters outside the selected font's repertoire are represented visibly by Unicode code point rather than dropped or rendered as blank squares. Excel preserves original Unicode text except the explicit XML control-character representation. Full multilingual visual acceptance beyond the exercised scripts remains pending.
- Packaged deployments must retain `apps/api/assets/fonts` alongside the API build. PDF generation uses these local assets only. No proprietary/system font is redistributed.

PDF files and Excel files are editable offline copies; operational evidence and trusted approval stay in the application. Hosting, independent staff acceptance, external notification delivery and archival/retention operations remain separate work. No deployment is included.

## REST endpoints

All routes require verified Supabase authentication and existing trusted scope. OpenAPI 0.9.0 documents query/response types.

- `GET /api/machines/:code/reports/preview`: `report=work-orders|planned-maintenance|investigations`, optional paired `from/to`, `basis=created|closed`, `status=ALL|OPEN|CLOSED`, optional `kind` on work-order reports. Planned reports use due dates; a closed-date/open-status combination is rejected.
- `GET /api/machines/:code/reports/export`: same filters plus `format=pdf|xlsx`, optional expected preview `fingerprint`. The UI always sends it.
- `GET /api/machines/:code/reports/work-orders/:id/export`: `format=pdf|xlsx` and required expected integer `version`.

400 invalid filters, 401 expired/missing identity, 403 unavailable trusted role/membership, 404 unavailable machine/order, 409 stale preview/version, 422 bounded export exceeded, 429 concurrent generation, 503 dependency/audit failure. Unknown fields and browser-authored organization/source data are rejected. There is no report-data write endpoint.

See VERIFICATION.md for executed HTTP/database/browser/PDF-layout checks and their acceptance limits.
