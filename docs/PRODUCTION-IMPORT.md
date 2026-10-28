# Production Excel milestone — 17 October 2026

## What is implemented

The authenticated **machine → Production** page supports one explicit full monthly sheet at a time, using the original layout or the compact standard template described below:

1. Read an `.xlsx` workbook's sheet list.
2. Pick a supported monthly sheet for the selected machine. The Production page uses company production automatically.
3. Preview date blocks, original job/activity rows, raw source cells, formula caches, control totals and validation issues.
4. Select valid blocks, acknowledge the notes and commit the selection atomically.
5. View production/scrap totals, missing-date gaps, job counts and import provenance from saved PostgreSQL records.

No workbook is edited or recalculated. Original bytes are bounded and processed in memory, then discarded. The user retains the original source file; parsed source cells, filename, sheet, SHA-256, parser version and row references are persisted privately. No workbook byte persistence, Supabase Storage bucket or upload of company data to a public site is implemented. Private Supabase Storage is required before adding original-file persistence.

## Recognized layouts and conservative interpretation

The first parser (`whc-production-v1`) recognizes the inspected WH-C monthly format: date/shift/job/quantity and job-change columns A–F, scrap categories G–AC, daily scrap control AD, production-plus-scrap control AE, downtime categories AG–AR and remarks AS, with headers in rows 4–6 and data starting at row 8. Header positions are validated before use, and category labels include original column letters so repeated labels remain distinct.

A heading identifying the selected registered machine and an unambiguous monthly sheet name are required. A file headed for another machine cannot be silently reassigned. EPL subsets are blocked because they overlap monthly tabs; wrong machine headings and unknown layouts require separate parser review. The workbook is never imported as an automatic union of sheets. The dropdown initially suggests the most recent supported month before the current month; the selected sheet is visible and must be explicitly previewed.

A date establishes a contiguous block. Blank date cells inherit only within that block. Blank separator rows end a block; a following date-less block is flagged rather than assigned a guessed date. Numeric Excel dates honor the workbook's date system; explicit dates must resolve to a real calendar day in the selected month. Date strings accept strict YYYY-MM-DD or DD-MM-YYYY / DD.MM.YYYY. Invalid dates, inconsistent shifts, ambiguous numeric strings, missing quantities, unsaved formula results, repeated date blocks and missing/conflicting controls exclude the entire block.

Multiple jobs can share A/B/C. Rows with activity/scrap/downtime but no job are preserved as ACTIVITY with nullable job production, rather than inventing a job or production quantity. Description and remarks text remain verbatim. Raw numeric caches are parsed floating-point JSON values, not the original XML number text; production/control amounts use the decimal precision described below. No customer/material/dimension extraction is asserted.

Job production is summed independently from daily E controls. Scrap categories are summed independently from daily AD controls. Both sums must reconcile within **0.01 kg**. Values are stored as PostgreSQL decimal(16,3); computations round individual numeric inputs to at most three decimal places and sum integer thousandths. Formula caches are read, not evaluated; cached-result limitations remain visible in the preview. Monthly footer/summary totals are never additional production.

Downtime values and causes remain raw with `UNCONFIRMED` units. No hour conversion, availability, engineering RCA or exact shift timestamps are derived. A separate HRS footer label is insufficient to establish the units of every daily cause-coded column.

## Authority and provenance

- Operators and technicians can read production for machines explicitly granted to them.
- Maintenance head, supervisor, management and administrator can read their organization's machine records.
- **M2 assumption:** administrators, maintenance heads and supervisors can inspect/preview/commit production workbooks. Management, operator and technician cannot import.
- Import permission is distinct from engineering review authority. Administrator still cannot approve or close an engineering issue merely by being administrator.
- Every endpoint checks Supabase identity, active trusted membership, role and machine scope. A browser organization/role claim is not accepted.
- AUTHENTIC means **user-declared** authentic production, not a cryptographic authenticity guarantee. A known synthetic label in the filename/heading cannot be submitted as authentic.
- Authentic and synthetic daily records retain separate uniqueness scopes and backend dashboard filters. As of 29 October, the Production page always requests AUTHENTIC company records and submits new previews with AUTHENTIC provenance; it no longer exposes a dataset selector or synthetic import mode. Existing synthetic records are neither deleted nor relabeled, and the backend retains their provenance/isolation for test and historical compatibility. Known synthetic filename/heading markers still reject company-data imports.

## Transaction and duplicate guarantees

ProductionImport stores a server-generated immutable preview snapshot. ProductionDay stores reconciled day totals/controls and references its import, organization, machine and source through relational constraints. ProductionRow retains each original row's job/activity kind, shift, description, quantity, categories, remarks and raw cells. SQL checks enforce non-negative values, control reconciliation and valid import-state timestamps.

A commit accepts only a preview UUID, selected block keys and an acknowledgement. Arbitrary quantities, dates, source changes and roles in a commit payload are rejected. Previews expire for commit after 24 hours; they are not automatically deleted or publicly exposed.

The transaction locks the single scoped preview row, checks selected blocks and existing day keys, inserts all day/row records, marks the preview committed and appends the audit event. Audit failure rolls everything back. A retry of the same preview/selection returns its original result without adding data or another commit event. A different selection on a committed preview returns conflict.

The unique `(organization, machine, source, date)` constraint prevents duplicates across renamed files, changed workbook hashes, overlapping sheets and racing previews. A fresh upload shows already-imported dates as excluded. No corrections overwrite existing days in this milestone; correction/revision workflows need a separate design.

The runtime database login remains unable to modify memberships, existing machine metadata, saved production rows/days or existing audit events. Machine registration now has separate API-authorized insert/access/version grants (see MACHINE-REGISTRY.md); standard templates and machine-specific heading validation now extend import support without changing stored records. Grants permit only SELECT, production/audit INSERT, and the specific import status/timestamp/selection UPDATE columns. No runtime deletion or staged-snapshot editing is granted.

## Operational limits

- XLSX only, maximum compressed upload 8 MB.
- ZIP entries are inspected and streamed to enforce an actual expanded limit of 64 MB, at most 3,000 members, no duplicate/path-confused entries, encrypted files, workbook external links or VBA payloads.
- At most 100 sheets, 5,000 rows per sheet, 80,000 rows total, 64 columns, and bounded cell text.
- One workbook processor per user and at most two simultaneous processors per API process.
- Multipart counts/field sizes are bounded; JSON request bodies are limited to 64 KB.
- Dashboard windows are ordered real dates, maximum 366 days. The default window is the month of the latest saved record for the selected provenance, or the current India calendar month if no records exist.
- Missing dates remain null, not zero or interpolated output. Totals represent imported coverage, not a complete month's declared output.
- Synchronous parsing is intentional for bounded pilot files. Distributed queues, shared quotas/rate limiting and original-file Storage are deferred until required by a deployed workflow.

## Tests and private source evidence

Synthetic fixtures exercise cached formulas, multi-job shifts, activity rows, invalid dates, missing/ambiguous values, controls, scope, imports and chart states. Database tests verify retry idempotency, racing same/different previews, runtime grants, audit rollback and date/source uniqueness. Desktop and mobile browser fixtures verify the client review/commit flow, missing acknowledgement, role visibility, automatic company-data requests, conflict recovery, session expiry and tab switching.

The real WH-C September sheet was inspected locally. Eligible-block job/category sums were independently recalculated from its cached worksheet XML and compared with the parser; original workbook checksums were unchanged. Company totals, source rows and screenshots stay in ignored `.local` / private database storage, not this source document. Live authenticated import evidence is recorded separately in VERIFICATION.md when exercised.


## Standard template for every machine — 28 October 2026

The owner confirmed standard templates for now. Production is visible on every registered machine. Importers can download an empty month-specific workbook from the import popup; it has the selected machine code in A1, `maintenance-production-v1` in A2 and nine headers in row 4. Data starts at row 8. A–I are date, A/B/C shift label, original job/reference, production kg, job-change count, scrap kg, daily production control kg, daily scrap control kg and remarks. Date appears only on the first row of a contiguous day; its other job/activity rows remain together. G/H controls are entered once for that day and must independently reconcile with D/F sums. They are never extra production/scrap. No actual shift start/end times or downtime hours are inferred.

The parser retains original A–I cell addresses and raw values. Populated columns beyond I are rejected for this format; custom fields require mapping. Existing date/duplicate/source/cache/precision/atomic commit checks apply. Monthly summary rows must not be entered as jobs. Standard templates contain no invented data, formulas or sample production. Empty downloads create no database imports. The original A–AS monthly layout remains supported with matching machine headings; existing WH-C data/previews/parser versions remain valid. New parser versions are stored with their immutable staged snapshots and commit checks validate both the supported version and its matching import record. See STANDARD-EXCEL-TEMPLATES.md.

## Reviewed WHB company workbook — 28 October 2026

The owner supplied the WH-B-named workbook and explicitly confirmed that its “W & H B M/C” heading identifies the registered **WHB** machine, authorizing live production imports for that registration. Added the narrowly scoped `whb-monthly-production-v1` mapping: job/date/shift columns A–F, scrap G–AC, daily production/scrap controls E/AD, combined control AE, derived percentage AF, downtime AG–AS and remarks **AT**. AS is “no planning” downtime, never remarks. Original category/subcategory headers are checked and original cell addresses/caches are retained. The original WH-C and standard templates keep their mappings and versions. The separately reserved `WH-B` code remains reference-only; there is no global punctuation/alias normalization, generic heading override or automatic layout inference.

Blank-shift activity must remain visible without truncating later dates; it is retained and excludes its affected block rather than acquiring an invented shift. Control-only rows retain their original cells and daily control values, but a missing shift still excludes the block. No row gains an invented shift or passes preview only to fail the database’s required-shift constraint. Percentage-only rows are derived values, not production. The inspected footer's aggregate row followed by the explicit DOWN TIME summary is excluded; a later shift after a summary remains unsupported. These rules apply only to the reviewed WHB layout.

Populated columns beyond AT retain their raw cells and raise `UNMAPPED_COLUMN` on the entire affected date block. The supplied June sheet includes such cells; their units/meanings are not guessed. Invalid dates, missing shifts/quantities/controls, conflicting controls and reconciliation failures remain excluded. The supplied workbook is not edited/recalculated. Supported sheet eligibility means its format is recognized, not that every date is valid. Importers must explicitly preview one month, review excluded blocks, acknowledge notes and save selected eligible days. No automatic import of all sheets is performed.

## Receipt/schema hardening — 28 October 2026 audit

Prisma now correctly declares the existing `(orgId,machineId)` ProductionRow index as nonunique; job-level `(dayId,sourceRow)` uniqueness is unchanged. Migration 031 requires non-null committedDayKeys arrays with no null elements, matching the retry/selection application contract. It contains no row backfill or source-data edits. Existing hosted receipts were valid and all operational-table hashes/counts matched the private checkpoint afterward. Schema-contract integration checks cover generated uniqueness and scalar nullability, and production tests reject direct NULL/NULL-element receipt writes.

## Company-data Production page — 29 October 2026

At the owner’s request, removed the Authentic/Synthetic dataset dropdown and its demo-switch state. The date-filtered dashboard and import preview always send AUTHENTIC explicitly. Simplified the page/import copy to company production, while retaining original source references, excluded-date review and acknowledgement. Historical synthetic badges remain conditional on the stored record’s actual provenance; no data, source enum, constraints or API permissions are changed. The known-synthetic rejection message now explains that such a workbook cannot be imported as company production rather than directing users to the removed dropdown. Process trends remain a separate synthetic-data workflow.
