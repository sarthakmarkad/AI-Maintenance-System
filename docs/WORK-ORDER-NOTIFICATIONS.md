# In-app work-order notifications

WH-C machine pages display a compact **Work-order notifications** inbox above the workspace for the active Technician and Maintenance head views. It includes the unread count, explicit Refresh, action messages, source actor and IST time with seconds, work-order links, explicit Mark read and older-item paging. Other roles retain their existing scoped work-order reads and do not receive personal engineering handoffs. Administrator has no engineering authority.

## Handoffs and actionability

| Immutable source event | Current recipient | Actionable stage |
| --- | --- | --- |
| ASSIGN, including reasoned reassignment of any work kind | Current assigned technician, active Technician view | ASSIGNED |
| SCHEDULE from explicit calendar release | Current assigned technician, active Technician view | ASSIGNED |
| INVESTIGATE from explicit retained-review release or the compatible combined review/release API | Current assigned technician, active Technician view | ASSIGNED |
| SUBMIT, including each resubmission for BREAKDOWN, PLANNED and INVESTIGATION | Each currently eligible Maintenance head, active Maintenance head view | AWAITING_REVIEW |
| RETURN for every work kind | Current assigned technician, active Technician view | IN_PROGRESS |

Only the newest workflow event on an order can be actionable. ATTACH events preserve its handoff while independently advancing the work-order evidence version. Starting work removes its assignment alert; return supersedes the submitted-review alert; resubmission supersedes return; approval removes the review alert; closure has no handoff alert. Reassignment immediately removes access for the previous technician and creates one new current assignment alert. The normal versioned workflow remains the authority when someone opens an order.

Calendar Upcoming/Due/Overdue reminders and their receipts remain separate. Statistical detection and saving an investigation review alone create no work-order notification. The explicit human release event does. No email, SMS, push subscription, external delivery worker, invented schedule or operational seed notification is added. These are pilot implementation choices, not reconstructed SRS requirements.

## Historical behavior and retained evidence

The durable notification source is the existing immutable WorkOrderEvent, which already commits in the same transaction as the work order and protected workflow audit. There is no additional event emission hook or delivery queue to fail independently. Failed assignment/release/submission/return transactions cannot leave phantom alerts. The existing unique order/version event constraint and release/request retry guarantees apply to notification identities too.

There is deliberately **no cutover timestamp or backfill insert**. An existing pre-migration event appears unread on first use if it is still the latest actionable handoff for the current recipient. A newly granted head can see existing pending-review handoffs within that head's current organization scope. A re-enabled eligible recipient retains its earlier receipts. Completed/superseded stages do not become a second historical notification feed. Their immutable original evidence stays in work-order history and reports; saved read receipts remain retained after actionability ends. No past notification delivery, head roster or read time is invented.

A source event UUID is the notification ID. WorkOrderNotificationReceipt stores one append-only receipt per event, **actual user UUID and active role**, with the original server read time. A same-account six-role pilot must actively select its trusted Technician or Maintenance head view, and a read in one view cannot read another view's event. Different heads have independent receipts. Nothing combines grants or treats email/Google metadata as authority.

## Access and transactional reads

Every endpoint uses verified Supabase Auth and the normal active-role guard. The service also invokes WorkOrdersService.context inside the transaction to recheck active trusted membership, matching selected-role grant, organization and WH-C machine access. Technician access requires an explicit live machine grant and the current assigned UUID. All other role views return an empty personal inbox and cannot mark any handoff read. Foreign organization/WH-B/invalid recipient/stale-stage IDs cannot be read.

Explicit read locks the order with FOR SHARE, rechecks live access after acquiring the lock and re-evaluates stage/recipient before inserting. Workflow updates serialize against that lock. INSERT ON CONFLICT retains exactly one receipt/time under concurrent retries. The first receipt and WORK_ORDER_NOTIFICATION_READ audit commit atomically; retries do not append another audit. Read/list operations never advance the work-order version, add a work-order history event, or change workflow/evidence/times. A read racing a workflow action either succeeds before that transition or returns stale/not-found afterward.

Migration `202610240014_work_order_notifications` adds only the receipt table and a scoped event unique index. Composite event/member foreign keys, role checks, an insert trigger checking current trusted eligibility/stage, and append-only update/delete triggers protect receipt evidence. Runtime grants add INSERT on this table; the existing global SELECT grant applies. No UPDATE/DELETE/TRUNCATE grants or identity/engineering role changes are introduced. Database owners remain trusted administrators who can change triggers; this is not an external tamper-proof ledger.

## API

All paths require authentication under `/api/machines/WH-C/work-order-notifications`:

- `GET /`: newest-first 25-item keyset page; optional `after` source-event UUID. `unread` counts all current actionable handoffs, independently of paging. List/count share a repeatable-read snapshot. A superseded/foreign/invalid cursor requires refresh instead of silently omitting results.
- `POST /:id/read`: strict empty JSON object `{}`; identity, selected role and server time cannot be submitted. Returns `{read: true, readAt}` after receipt/audit commit. Identical retries retain the original timestamp. Stale stage/recipient returns 404, revoked membership/selected role returns 403, missing technician machine access returns 404. Normal 401/400/503 handling applies.

Responses expose source event version, order ID/title/kind, action, server-derived action message, source actor name, event instant and nullable readAt. The message does not claim a cause for synthetic statistical evidence. Parent integration should run OpenAPI generation, then replace the temporary DTO-shaped aliases in `work-order-notifications-types.ts` with generated WorkOrderNotificationDto/WorkOrderNotificationsDto aliases. This branch deliberately does not modify generated contracts.

## Browser behavior

Opening/expanding the list never marks anything read. Mark read explicitly saves a receipt. Open work order saves/rechecks the receipt first and navigates only after success, including on an already-read item. Failed receipts leave an error and require successful Refresh before actions resume. Stale-access/stage errors clear actionable items. Session expiry uses the existing expiry/sign-in flow.

The compact inbox polls every 30 seconds only while the page is visible. Expanding the inbox pauses automatic polling so older-page results stay stable. Refresh explicitly replaces the current inbox page. In-flight list requests, receipts and polling do not race each other. This component never calls router.refresh or reloads its parent; unrelated workflow form drafts survive polling and notification refresh. Unmount aborts pending list work. Per-user/active-role keys isolate view state. Initial loading, transient failures, explicit retry, empty state, busy actions, keyboard controls and narrow mobile layouts are provided.

## Verification and parent integration notes — 24 October 2026

Executed in the assigned `t3/work-order-notifications` worktree only:

- Prisma schema validation passed using dummy, unreachable local URLs; validation/generation did not connect to any database.
- Dependencies were copied into this worktree's own independent node_modules (copy-on-write filesystem clones), and Prisma generated only into that copy. No npm ci/install or parent generated-client mutation was used.
- `npm run typecheck` passed for backend, frontend and test sources, including all new integration fixtures.
- `npm test` passed all **58** backend unit tests (55 existing plus 3 notification tests).
- `npm exec playwright -- test --config tests/notifications.playwright.config.ts` passed **24/24** tests (12 desktop/mobile cases each) on independent local port **3214**, using intercepted synthetic Auth/API fixtures only. Covered count/IST/read controls, no read-on-expansion, successful/failed receipt navigation, stale stage/revocation clearing, outage recovery/paging, retained open technician draft while polling, head review messages, four nonrecipient role views, session expiry, initial loading, keyboard expansion/empty state and no mobile horizontal overflow. Desktop/mobile screenshots were visually inspected.
- **15 PostgreSQL HTTP/integration tests are implemented and compile but were not executed here**, as the parent reserved database preparation/migration and integrated suites. They cover all creation/release paths, every work kind's submission/return/resubmission, concurrency/exact retries, per-actual-user/role receipts, six-role pilot isolation, trusted eligibility/revocation, foreign/reference scope, current/superseded stages, attachment-only versions, workflow/read audit rollback, source/receipt SQL protections, pagination/counts and read/start races. No operational migration, database mutation, notification seed, root .env read/copy, port 3000/4000 service, push or deployment occurred.

Parent must apply/review the migration and grants in the isolated test database, generate its Prisma/OpenAPI clients, run these integration cases and the full original workflow/report suites, then merge actual evidence into shared VERIFICATION/README/DECISIONS/SCOPE/TEAM-ACCESS documentation. No hosted-auth or real independent-staff browser acceptance is claimed. SQL trigger/grant execution remains unverified until that integrated run.

Shared integration files touched: `apps/api/src/app.ts` (controller/provider registration), `prisma/schema.prisma` (receipt model/scoped event key), `infra/runtime-grants.sql` (receipt INSERT), `apps/web/components/shell.tsx` (inbox mount), and `tests/browser/helpers.ts` (empty notification response for existing role/workflow browser fixtures). No workflow service, report implementation, generated contract or shared feature-policy document is changed. Next-generated next-env changes from local browser runs are excluded from the commit.
