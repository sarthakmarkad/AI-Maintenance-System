# Removing records while retaining maintenance history

The owner explicitly chose history-preserving removal. There is no cascade purge of operational equipment, reports, files, imported data or audit records.

| Area | Available action | Active authority | Retained records |
|---|---|---|---|
| Machine registry | Archive / restore, with a reason | Administrator | Code, details, photo, access grants, every linked record and audit |
| Work orders | Cancel with a reason before approval | Maintenance head | Original report, assignment, findings, evidence, source links, events and audit |
| Saved conversations | Remove from own chat history | Actual owner in the same active role and machine scope | Original conversation/turns plus immutable archival receipt |
| Recurring maintenance | Existing pause / resume | Maintenance head | Plan and generated obligations |
| Unreleased scheduled tasks | Existing skip with a reason | Maintenance head | Occurrence, due date and skip history |
| Current approved manuals / SOPs | Existing withdrawal with a reason | Maintenance head | Every revision, approval, file and withdrawal event |
| Machine photos and access | Existing photo removal and grant revocation | Administrator | Audit; work-order evidence is separate |
| Email alerts | Existing personal opt-out | Current recipient | Prior immutable delivery evidence |

## Machines

Use **Asset registry → Archive machine** (also available on overview). Enter a reason and confirm. The default registry lists active machines; **Show archived machines** switches to archived records within the same read scope. Historical machine links, reports, files and scoped data remain readable.

Before archival, all work must be CLOSED or CANCELLED, all recurring plans must be paused, and all outstanding unreleased occurrences must be explicitly skipped by the head. The Administrator cannot make these engineering decisions. Archival never silently completes or discards a maintenance obligation.

Archived workspaces reject operational writes and hide the principal creation/management controls. Restore with a reason to return equipment to the active registry; existing machine grants remain, and paused plans stay paused until a head explicitly resumes them. Codes remain reserved, so restore the existing record instead of registering a duplicate.

Lifecycle mutations share the registry version, short machine-row lock, exact action-scoped request receipt and atomic audit. Competing updates require refresh. Database guards serialize operational inserts with archive updates and enforce blockers even outside HTTP. Metadata, photo and access changes require restoration first. No machine DELETE grant was added.

## Work orders

The head uses **Cancel work order**, enters a reason and confirms. BREAKDOWN, PLANNED and INVESTIGATION work can be cancelled from REPORTED, ASSIGNED, IN_PROGRESS or AWAITING_REVIEW. Approved and closed work cannot be cancelled. Administrator, Operator, Technician, Supervisor and Management do not receive cancellation authority.

CANCELLED is terminal. It records an immutable CANCEL event and audit at the next version, preserving original/current evidence and every previous submission. It does not record restoration, performed time, approval or closure. Existing downloads remain available. Cancellation is a separate terminal outcome, not a seventh completion step.

A cancelled planned order retains its occurrence and stops its actionable reminders; that occurrence is not completed and cannot be released again. Future fixed dates continue until the plan is paused. Investigation reviews remain immutable and retain their linked cancelled order. No follow-up incident or replacement is created automatically.

Open backlog, reminder eligibility, report OPEN filters and planned compliance denominators exclude cancellations. Calendar filters and report totals identify them separately. Existing email actionability checks suppress queued stale handoffs; an already-started external send cannot be recalled.

Version conflicts do not auto-retry against a newer order. Replaying a successful cancellation with an old version returns a conflict; reload to see its terminal status. SQL requires a head event, nonempty reason, protected audit and unchanged evidence for cancellation.

## Conversations

Use the remove icon next to a saved conversation, then confirm. Ownership includes organization, machine, actual user and selected trusted role. Other people, including Administrators, cannot remove that user's conversation. Removal is idempotent and hides its listing/transcript; the interface does not offer restoration.

Original turns remain immutable. The separate archival receipt and protected audit commit together. A removed thread cannot be revived by a saved request key or a new message. Removal and final reply persistence use the same owner lock, so removal during generation prevents that new reply from being saved or delivered. Text already delivered or copied cannot be recalled.

## Boundaries

Existing plan pause/skip and document withdrawal already provide the appropriate lifecycle controls. This change adds no generic deletion of source evidence, committed production/readings, approval history or audit. Draft/obsolete library revision retention remains as documented in DOCUMENT-LIBRARY.md; withdrawing an approval never restores an older version.

API additions:

- GET /api/machines?archived=true|false (default false).
- POST /api/machines/:code/lifecycle: requestId, expected version, archived boolean and reason; Administrator only.
- POST /api/machines/:code/work-orders/:id/actions/cancel: expected version and reason; Maintenance head only.
- POST /api/machines/:code/assistant/chats/:id/archive: strict empty object; owner only.

Migrations 027–030 and the narrow runtime grants implement the lifecycle changes. Test writes belong exclusively in the isolated database. See VERIFICATION.md for actual checks and live-data preservation evidence.
