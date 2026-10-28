# Maintenance performance — milestone 7

Open **WH-C → Maintenance performance**. This read-only dashboard summarizes saved work orders and generated maintenance-calendar tasks. It is available to all six trusted role views within their existing organization/machine scope. No additional grants, identity bypass, schema migration, imports or new workflow mutations are introduced.

## Daily workflow

1. Select the active role, open WH-C and choose Maintenance performance from the sidebar or machine overview.
2. Choose inclusive **From/To dates in IST** and optionally a work type. Apply filters. The default is today and the previous 29 local dates; the maximum is 366 days and dates cannot extend beyond today.
3. Inspect workload, current bottlenecks, activity, planned-task completion and investigation outcomes. Every result identifies its filter and refresh time.
4. Open a linked source work order or the maintenance calendar to inspect evidence and perform an authorized action. The dashboard itself never assigns, submits, approves, closes, skips or releases work.
5. Return and use **Refresh performance** to obtain a fresh snapshot after activity. The dashboard does not poll or promise live telemetry.

## Role activities

| Active role | Dashboard use | Operational action through existing source pages |
|---|---|---|
| Operator | Inspect reported work, current states and delays on granted machines | Report observed issues through Work orders |
| Technician | Inspect workload and the server-derived **Assigned to you** open-order count on granted machines | Start/submit only orders assigned to that identity |
| Maintenance head | Identify unassigned work, pending engineering review and overdue planned obligations | Assign/reassign, release planned/investigation work, approve/return and close as already authorized |
| Supervisor | Inspect overdue tasks and approved work waiting for closure | Close approved orders; cannot perform engineering approval |
| Plant management | Inspect workload, delays, outcomes and planned-task completion | Read-only; no operational mutations |
| Administrator | Inspect scoped performance and data-coverage limitations | No engineering assignment, repair, approval or closure authority |

All roles receive the same scoped machine aggregates; technician additionally receives its own assignment count. This is operational visibility, not a new personal-only read restriction. A multi-role identity uses exactly one currently granted role; selecting a role does not combine permissions. Revoked membership/roles/machine access apply to subsequent requests.

## Metric definitions

Policy `maintenance-workflow-v1` is an implementation choice for this pilot, not a reconstruction of missing SRS requirements. The API reads one PostgreSQL repeatable snapshot and captures a server refresh instant. This page does not reconstruct the past state of the maintenance system at an earlier date.

### Creation dates, activity dates and current backlog

- **Orders created in range**: orders with reportedAt in the selected IST dates, through refresh time. Their six state counts and work-type counts describe their **current** state. CLOSED is complete administrative closure; submission, performed time, restoration and approval do not substitute for closure.
- **Orders closed in range**: closedAt in the selected IST dates, independently of creation date. Earlier-created work can contribute, so this number is not a completion ratio against orders created in range.
- **Daily activity**: separate created and closed counts by IST date. Empty dates contain genuine zero action counts, not interpolated process readings. The accessible table supplies the same values as the chart.
- **Current backlog**: all non-CLOSED orders, across all creation dates, respecting the work-type filter. Older unfinished work is not hidden by the date range. Current state counts include REPORTED, ASSIGNED, IN_PROGRESS, AWAITING_REVIEW and APPROVED. Age means elapsed clock time since creation, not an SLA breach or machine downtime. The oldest ten orders link to source evidence; counts include the complete scoped backlog.
- **Overdue planned tasks**: all generated, non-skipped tasks with dueAt strictly before refresh time and no CLOSED or CANCELLED order, including unreleased occurrences and obligations from paused plans. This uses all due dates. A type filter excluding PLANNED makes this measure inapplicable. Incomplete scheduling is explicitly flagged because generated tasks can understate outstanding obligations.

### Planned maintenance

Use generated occurrences whose fixed dueAt falls in the selected IST dates **and is at or before refresh time**. Future due instants, including later today, are excluded. Skipped and cancelled tasks are reported separately and removed from the eligible denominator. Completed means linked work order CLOSED with a recorded closure. On-time means closedAt <= fixed dueAt; the actual performedAt stays independent. Open tasks remain in the denominator, avoiding a percentage based only on finished work.

- Closed percentage = closed / eligible due tasks.
- On-time closed percentage = on-time closed / eligible due tasks.
- No eligible tasks → unavailable percentages, not 0% or 100%.
- Scheduler failure or any active plan cursor still due by refresh time → explicit partial-coverage warning and unavailable percentages until generation catches up. Pausing does not remove already generated obligations. A new API process may have no observed last-run timestamp; durable plan cursors still determine catch-up.

This is **administrative closure timeliness**, not a claim that physical maintenance was late whenever review/closure was late. The calendar and work-order detail retain the evidence needed to distinguish those times.

### Investigation outcomes

For INVESTIGATION orders created in selected dates, count latest current submitted outcomes and separately how many are APPROVED/CLOSED. Returned and awaiting-review submissions remain provisional. No current submission and earlier submissions with no recorded outcome are counted explicitly. Reassignment can clear current outcome fields while preserving earlier immutable history. A maintenance/sensor recommendation is not an automatically created repair or evidence that follow-up work is complete. Synthetic source readings cannot establish authentic faults, production-loss causes or validated machine reliability.

### Excluded metrics

At the owner's request, Workflow timing and MTTR, MTBF and machine-availability placeholders have been removed from this dashboard and its API response. The dashboard focuses on workload, planned-task closure and investigation outcomes. Existing missing-data indicators within those implemented measures remain intact.

## API, limits and verification

`GET /api/machines/WH-C/performance` accepts optional paired `from`/`to` and `kind=BREAKDOWN|PLANNED|INVESTIGATION`. Extra scope, role, machine, status or arbitrary fields are rejected. Supabase identity and trusted role/machine scope are rechecked in the same transaction via the existing WorkOrdersService access policy. No POST or generic modification endpoint exists. API/OpenAPI response types are generated for the frontend.

The bounded pilot aggregation allows at most 10,000 creation records, 10,000 closure records and 10,000 due occurrences per request; an exceeded limit returns a clear error to narrow the window instead of returning partial totals. At most 1,000 active plans per scoped machine are checked for scheduling coverage; excess returns unavailable. Current backlog counts are database aggregates; only the explicitly labelled oldest ten evidence links are limited. Queries use existing indexes and restricted runtime SELECT permissions. No cache, new database grant, automatic incident, notification, deployment or public export was added.

Unit, isolated PostgreSQL HTTP and desktop/mobile fixture checks cover date boundaries, separate denominators, current versus selected-date views, scope/role/revocation, read-only behavior, calendar completion, incomplete scheduling, filtering, retries and session expiry. Live browser acceptance reads existing records; all synthetic mutation fixtures stay in `_test`. See VERIFICATION.md for actual executed evidence and limits.
