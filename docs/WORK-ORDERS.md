# Breakdown reporting and maintenance work orders

Milestone 4 is implemented locally for WH-C at `/machines/WH-C/work-orders`. Work orders come from operator reports. Imported synthetic readings and retrospective review flags never create incidents, establish a fault cause or populate human RCA automatically.

## Responsibilities and states

| Action | Authority | Result |
|---|---|---|
| Report observed symptoms, priority and impact | Operator with WH-C access | REPORTED |
| Assign an active, machine-granted technician | Maintenance head | ASSIGNED |
| Start repair | Assigned technician | IN_PROGRESS |
| Submit findings, human RCA, corrective/preventive actions and restoration time | Assigned technician | AWAITING_REVIEW |
| Return with a reason | Maintenance head | IN_PROGRESS |
| Approve submitted repair | Maintenance head | APPROVED |
| Close approved work | Supervisor or maintenance head | CLOSED |

All six application roles can read within their organization and machine scope. Operators and technicians require explicit machine grants. Administrator has no report, assignment, repair, engineering approval or closure authority. Roles come from active trusted database memberships and explicit additional grants. A browser role selection is checked against those grants and never grants authority by itself. The service rechecks membership and machine access inside each operation's transaction. Revoked membership/grants deny subsequent requests.

Head-only assignment, six state labels, four mandatory repair text fields, explicit restoration at submission and terminal closure are provisional pilot choices inherited from the draft and accepted for this implementation. They are not reconstructed authoritative SRS requirements. Reporting does not require a known root cause. Reported impact is a human observation, not a verified downtime classification.

Reassignment is allowed from ASSIGNED or IN_PROGRESS, including work returned after review. It requires a different eligible technician and a reason. It resets the current repair/start/submission/restoration fields and returns to ASSIGNED. Earlier repair submissions, assignments and return reasons remain in immutable history. A submitted repair must be returned before reassignment. Reopening, cancellation, deletion and arbitrary state editing are not implemented.

## Evidence and time

The original title, symptoms, reported priority/impact, reporter and observation/report times remain unchanged. A report keeps an optional explicitly entered first-observed time, which cannot be in the future. The server records report, repair start, submission, approval and closure times independently. The technician supplies service-restored time, required between report time and submission time; it is not copied from engineering approval or closure. This pilot choice does not support restoration before the report was filed.

Inputs use Asia/Kolkata wall-clock time with seconds, converted explicitly to UTC instants. PostgreSQL stores timestamptz(3); the UI displays IST with seconds. No downtime, MTTR or prediction accuracy is inferred from these records yet.

Each accepted action appends a numbered event with the actor's name/role snapshot, old/new state and relevant evidence. Submission events retain all four repair fields and restoration time; return events retain the reason. Current repair fields can change on a new submission, while prior event evidence stays readable. The detail page loads the latest 50 events and pages older history without truncating it. Database owners remain trusted administrators who can alter triggers; this is not an external tamper-proof ledger.

## Retries, concurrency and database protections

- Reports use a UUID request key scoped to organization and reporter plus a fingerprint of normalized content. Identical concurrent retries produce one report/event/audit record. Changed details with a reused key return 409. The form preserves the key and draft after a failed request; a new report form receives a new key.
- Every action carries the last observed integer version. A scoped database compare-and-update increments it exactly once. A competing update returns 409; the UI blocks further actions until explicit reload and never retries automatically against a newer version.
- Work-order update, immutable history and protected audit append share one transaction. An audit/history failure rolls back operational changes too.
- Composite foreign keys constrain the machine, reporter, technician, reviewer, closer and event actor to the same organization. State/time checks and a transition trigger provide database-level consistency protections.
- Runtime grants permit new reports/events and only workflow-specific update columns. They deny original report edits, deletes, identity/role changes and history/audit updates. No direct browser database grants are added.
- Strict request schemas reject unknown fields, malformed/calendar-invalid dates, missing human evidence and forged role/org/status fields. Assignments check current active membership and machine access.

## REST contract

All paths are under `/api/machines/WH-C/work-orders` and require verified Supabase authentication. See generated OpenAPI for response types.

| Method and suffix | Purpose |
|---|---|
| POST `/` | Operator report: requestId, title, description, priority, impact, optional observedAt |
| GET `/` | Scoped list; optional status, limit (1–50, default 25), after UUID cursor |
| GET `/technicians` | Head-only directory of eligible technician IDs/display names; pilot maximum 200 |
| GET `/:id` | Current report, server-derived allowedActions and latest history |
| GET `/:id/history?beforeVersion=N` | Older events, 50 at a time |
| POST `/:id/actions/:action` | Versioned assign/start/submit/approve/return/close |

Action bodies contain `version` and only action-specific fields: assign requires technicianId and a reason on reassignment; start uses version only; submit requires findings, rootCause, correctiveAction, preventiveAction and restoredAt; return requires reason; approve/close accept an optional note. Text fields use 3–4,000 trimmed characters, title 3–160. Timestamps require an explicit UTC offset.

Lists use newest report time and UUID as a stable keyset, with counts across all scoped states independent of the selected filter. Read summaries/detail use a repeatable snapshot. History uses immutable event versions as its cursor. Records are not editable through generic PATCH endpoints.

## Local acceptance and remaining boundary

The migration and restricted runtime grants are applied to local operational and isolated test databases. Actual Administrator reads were verified in Codex's built-in browser using hosted Auth and the real API. No fake incidents or role changes were added to operational data. Full workflow authorization, concurrency, rollback, long-history paging and SQL protections are verified against the separate test database; desktop/mobile action forms use intercepted test fixtures. The same existing hosted identity now has six explicitly granted pilot views at the user’s request; this does not establish independent-person approval separation. Separate staff identities still need live acceptance.

Notifications, attachments, original workbook storage, scheduled maintenance, calendars, exports, KPI definitions and AI diagnosis/RCA drafting remain future work. Supabase-hosted operational database migration and deployment are still pending. Nothing is published.

## Planned work extension (M5)

BREAKDOWN behavior remains as above. Explicit maintenance-head release from a calendar occurrence creates an assigned PLANNED order with SCHEDULE history and immutable occurrence linkage. Planned submission requires findings, work performed (correctiveAction in the REST contract) and an explicit performedAt; follow-up recommendations are optional. It rejects breakdown root-cause/restoration fields. The same head review/return and approved closure permissions apply; the calendar marks completion only on CLOSED. Due, performed, submitted, reviewed and closed instants remain separate. See CALENDAR.md.
