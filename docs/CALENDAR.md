# Planned maintenance calendar — milestone 5

The WH-C calendar lives at `/machines/WH-C/calendar`. It implements recurring plans, date/status views, explicit task release, reviewed planned-work completion, reasoned skips and durable in-app reminder records. No sample company maintenance plan is seeded.

## Fixed calendar rules

The user chose **fixed calendar dates** on 18 October 2026. Every occurrence is calculated from the original first due time, frequency and interval. Completing, closing or skipping work late never moves the next deadline.

- Frequencies: daily, weekly or monthly; every 1–12 periods.
- Timezone: Asia/Kolkata. Inputs require an explicit offset; storage uses UTC timestamptz(3), and screens display IST.
- Monthly dates clamp to the shorter month's last day without drifting. A January 31 anchor produces February 28/29 and then March 31.
- First due time may be at most 31 days before the current IST day or 366 days ahead. This is a conservative pilot input boundary, not an engineering maintenance interval recommendation.
- Occurrences are materialized through the next 35 days. The month grid includes six weeks, with counts across all statuses; days beyond the generation horizon may have no materialized tasks yet. Plans remain visible in the Plans tab even if their first due date is farther away.
- The pilot supports at most 100 plans per machine, including paused plans. Creation is serialized per organization/machine to keep the limit and retries consistent.

Upcoming means the due date is after today's IST date. Due today means today's deadline has not passed. Overdue begins immediately after the explicit due instant. Only reviewed closure marks a released occurrence Completed; submitting work or receiving approval alone does not close it. A reasoned unreleased skip is a separate Skipped state. Calendar metrics apply to the displayed date range or selected day; the reminder inbox can include older outstanding work outside that range.

## Responsibilities

All six views can read the calendar in their organization; operators/technicians still need WH-C access. Only the Maintenance head can create/pause/resume plans, release a scheduled task or skip an unreleased occurrence. Administrator remains a read-only calendar role and does not acquire engineering authority. The existing explicitly granted pilot role views work unchanged.

Each plan selects an active technician with machine access. A head releases an occurrence with a currently eligible technician, producing one assigned PLANNED work order. Release is an explicit engineering action, not an automatic operator breakdown report. The head may choose another eligible technician at release; later reassignment uses the existing work-order action and reason. Calendar cards identify the original planned technician, while the work order retains current assignment and assignment history. Reminder ownership follows the current work-order technician once released.

The assigned technician starts the planned work and submits inspection findings, work performed and an explicit maintenance-performed time between order creation and submission. Follow-up recommendations are optional. Planned submissions reject breakdown root-cause/restoration fields: routine maintenance does not require an invented fault or restoration. The maintenance head approves or returns with a reason, and a supervisor or head closes approved work. Performed, submitted, reviewed and closed times remain independent. BREAKDOWN work retains its original mandatory human RCA, corrective/preventive action and restoration rules.

## Pause, skip and changes

Pausing stops creation of additional occurrences. Already generated tasks remain obligations, stay visible and continue to remind their owners. Resuming catches up missed fixed dates. A head can skip an unreleased occurrence with a reason without changing the next due date; released work follows its review/closure flow or is explicitly cancelled by the head with a reason. Skip and release lock the same occurrence, so simultaneous requests cannot produce both outcomes.

Plan cadence, first date, title, instructions, priority and default assignment are immutable in this milestone. Create a replacement plan and explicitly handle outstanding occurrences if those need to change. There is no silent rescheduling, bulk deletion, permanent deletion of released work, reopening or generic edit API. Plan state changes and skips are versioned and audited.

## Durable scheduling and reminders

The NestJS background worker runs at startup and every 30 seconds while the API is running. PostgreSQL stores the next sequence for each plan. Each generation transaction locks and rereads its plan, inserts up to 128 occurrences, advances the cursor and appends an audit event atomically. A failed audit rolls back both occurrences and cursor, so restarting/retrying cannot silently skip work. Unique `(planId, sequence)` and `(planId, dueAt)` keys prevent duplicates across worker instances.

Each run handles up to 100 active plans and 250 newly eligible reminders. A process cursor rotates through larger plan sets; durable plan cursors survive restarts. Large missed backlogs may require several runs. A catching-up or failed-refresh notice distinguishes incomplete generation from a fully current schedule. This is a local bounded scheduler, not a deployed Redis/BullMQ queue or an availability guarantee.

Reminder stages are Upcoming (within the configured 1–14 day lead), Due today and Overdue. Each occurrence/stage has one immutable reminder record. Readers only see the current stage, so old upcoming reminders do not stack beside overdue reminders. Closed/skipped/cancelled tasks disappear from the actionable inbox without deleting their reminder history.

Heads and supervisors see scoped outstanding reminders. Technicians see their own assigned work, following reassignment. Other roles have no personal reminder inbox items. Mark-read receipts are append-only and unique per reminder, identity and active role; reading in one pilot role does not mark another role's view read. Revoked grants and assignment changes apply on subsequent reads. The calendar polls every 30 seconds while idle, preserves open form drafts and suspends automatic refresh during a conflict or action edit.

No email, SMS, browser push, external calendar subscription, Google Calendar connection or Codex automation is created. When the local API is stopped, jobs wait until it restarts; unread records remain in the database. Original plans/source snapshots and protected reminder/read history cannot be overwritten through runtime grants.

## Data and REST contract

New tables are MaintenancePlan, MaintenanceOccurrence, MaintenanceReminder and MaintenanceReminderReceipt. Composite foreign keys preserve organization/machine/member scope. Occurrences snapshot plan instructions, due time, priority and planned technician. WorkOrder adds default `kind=BREAKDOWN`, nullable scoped occurrence linkage and planned performedAt; existing reports/history remain unchanged. A planned insert cannot link a skipped occurrence, and a released occurrence cannot be skipped. Work-order events add SCHEDULE, with the actual head actor/role.

All routes require verified Supabase authentication and live trusted role selection under `/api/machines/WH-C/calendar`:

| Method / suffix | Purpose |
|---|---|
| GET `/` | Inclusive from/to dates, maximum 62 days; optional status/after cursor; 100 tasks per page, complete range metrics and daily counts |
| GET `/plans` | Scoped plans and server-derived management availability |
| POST `/plans` | Head creates plan with stable UUID request key; same content replays, changed content conflicts |
| POST `/plans/:id/state` | Head pause/resume with current version and reason |
| POST `/occurrences/:id/release` | Head releases one assigned work order; identical retries return its existing ID |
| POST `/occurrences/:id/skip` | Head skips unchanged, unreleased work with a reason |
| GET `/reminders` | Current actionable stage, unread count and 25-item keyset pages |
| POST `/reminders/:id/read` | Empty object body; server-controlled identity and role receipt |

Strict schemas reject unknown fields, invalid calendar dates, client-supplied organization/status/authority and invalid assignments. Calendar list counts use a repeatable snapshot, and paging is by due time/UUID. Work order, occurrence release/version, immutable work history and audit share one transaction. Runtime grants allow only narrow state/cursor/performed-time updates; roles/registry and original report columns remain protected. Database owners are trusted administrators, not an external tamper-proof ledger.

## Verification boundary

Migrations and restricted grants are applied to local operational and isolated test databases. Real PostgreSQL HTTP tests cover scope/roles, recurrence retries, pause/catch-up, reminder deduplication/ownership/role-specific reads, release/skip races, full planned completion/review/closure, audit rollback, paging and SQL protections. Desktop/mobile browser fixtures exercise create/retry, date/status selection, pause/resume/skip, release, planned submission, reminders, conflicts and expiry. They are not hosted browser authentication claims.

Actual stored-role service reads and an empty scheduler run used the restricted operational connection through trusted local administration. No fake plans or incidents were inserted. The built-in browser redirected to login; no new credential entry or authenticated live calendar acceptance is claimed. The user can open the calendar in their signed-in browser and select Maintenance head to create the first real plan. Existing company production/readings, the user's work-order/history and role records were compared against the pre-change snapshot; original workbook hashes remain unchanged.


## Cancelled occurrences

A cancelled PLANNED order remains linked to its original occurrence, appears under the CANCELLED filter and stops actionable reminders. It does not count as completed maintenance and cannot be released a second time. Only that occurrence is cancelled; pause the plan to stop future generation. Machine archival requires paused plans and resolved or explicitly skipped obligations. See RECORD-REMOVAL.md.
