# Opt-in external email handoffs (WH-C pilot)

Implemented and integrated on 27 October 2026. Email is disabled unless every optional backend setting is supplied explicitly. Schema, narrow runtime grants, generated contracts and role-specific navigation are applied; live delivery remains unconfigured. No real email or operational test subscription was created during acceptance.

## Backend integration and contracts

The root module registers the following controller and providers:

```ts
import { ExternalNotificationsController } from './external-notifications/controller';
import { ExternalNotificationsService } from './external-notifications/service';
import { ExternalNotificationsWorker } from './external-notifications/worker';
import { NOTIFICATION_CONTACT, SupabaseNotificationContactResolver } from './external-notifications/contact';
import { NOTIFICATION_EMAIL, ResendNotificationEmailProvider } from './external-notifications/provider';
// controllers: [..., ExternalNotificationsController]
// providers: [..., ExternalNotificationsService, ExternalNotificationsWorker,
//   { provide: NOTIFICATION_CONTACT, useClass: SupabaseNotificationContactResolver },
//   { provide: NOTIFICATION_EMAIL, useClass: ResendNotificationEmailProvider }]
```

The service injects existing `Database`, `WorkOrdersService`, `CONFIG`. No auth.ts changes. `NOTIFICATION_CONTACT` is the sole HTTP contact-resolver double; `NOTIFICATION_EMAIL` is the sole provider double. Settings GET requires normal `AuthGuard`/`RolesGuard`, and unsupported roles return `supported:false` with no address/history. PUT rejects unsupported roles and strict payloads accepting only `{enabled,version,requestId}`. Role and scope come from the authenticated principal and live transactional `WorkOrdersService.context`.

API routes: `GET /api/machines/:code/external-notifications`, `PUT /api/machines/:code/external-notifications/preference`. Both return `ExternalNotificationSettingsDto`. GET never enables/enqueues/sends. PUT never sends. Use optional Config fields `EXTERNAL_NOTIFICATIONS_ENABLED`, `NOTIFICATION_EMAIL_PROVIDER`, `RESEND_API_KEY`, `NOTIFICATION_EMAIL_FROM`. Existing `WEB_ORIGIN` determines links. For staff delivery, the sender must belong to an owner-verified Resend domain. The pilot-only `onboarding@resend.dev` sender is restricted by Resend to the email associated with that Resend account. Unset settings disable enqueue and worker. An enabled preference can always be disabled while provider configuration is missing.

Web route is independently implemented at `/machines/[code]/notification-settings`. It loads trusted `/me` and uses the existing `Shell` and `useAuth`. Optional shared-shell navigation link: `<Link href={`/machines/${encodeURIComponent(code)}/notification-settings`}>Email settings</Link>`. The self-contained `ExternalNotificationsSettings({code,user,token})` export from `components/external-notifications.tsx` can instead be mounted inside an existing machine workspace, keyed by actual user/role. It does not poll or refresh its parent, mark in-app notifications read, or mutate work orders.

Migration `prisma/migrations/202610270021_external_notifications/migration.sql` was rehearsed in isolated `_test` and applied to the hosted private schema through native Prisma with verified TLS. The exact tables/scoped foreign keys are mirrored in schema.prisma. Services use parameterized SQL for the queue operations. Constraints, partial indexes, append-only guards, invoker function access checks and atomic audit triggers must remain SQL even if Prisma models are added.

Runtime grants are included in infra/runtime-grants.sql (the existing psql variable selects only the restricted runtime role):

```sql
GRANT SELECT, INSERT ON maintenance."ExternalNotificationPreference",maintenance."ExternalNotificationOutbox",maintenance."ExternalNotificationAttempt" TO :"runtime_role";
GRANT UPDATE(status,"attemptCount","nextAttemptAt","firstAttemptAt","leaseToken","leaseUntil","providerId",code,"updatedAt") ON maintenance."ExternalNotificationOutbox" TO :"runtime_role";
GRANT EXECUTE ON FUNCTION maintenance.external_notification_access(UUID,UUID,UUID,maintenance."Role"),
 maintenance.external_notification_actionable(UUID,UUID,UUID,UUID,maintenance."Role"),maintenance.external_notification_current(UUID),
 maintenance.check_external_preference(),maintenance.check_external_outbox(),maintenance.audit_external_notification(),
 maintenance.check_external_attempt(),maintenance.audit_external_late_result() TO :"runtime_role";
```

No UPDATE/DELETE/TRUNCATE for preference or attempt evidence; no identity/grant writes; no PUBLIC/anon/authenticated/service_role access. Trigger invoker writes require INSERT on attempts and existing AuditEvent. Apply all feature function grants after any broad function revocation in existing grants script. No SECURITY DEFINER, new external dependency, exposed schema or Storage bucket is used.

## Delivery behavior and limits

Only active Technician and Maintenance head views opt in for themselves. Enabling resolves the exact authenticated UUID's confirmed email through configured Supabase Auth `getUser(token)`, not JWT/browser/Google profile metadata. A failed lookup or unconfirmed/mismatched identity fails closed. The bearer is never stored. Disable needs no contact lookup. Destination is visible only to that recipient in the current selected role. Independent heads each opt in and receive separate deliveries.

Preferences are immutable revisions with organization/machine/user/role versions, server enrollment/verification times and exact-request fingerprints. A database advisory transaction lock plus unique constraints serialize updates. Exact retries of a saved revision reuse that revision; conflicting versions or changed bodies under its saved request ID return 409. An unchanged no-op save returns the current preference without reserving a new request ID or creating another revision. New enrollment, re-enable, or changed confirmed address establishes a new cutoff and invalidates all older queued items. Re-saving an unchanged address/enabled state does not reset enrollment. Old messages never silently redirect to a new address.

There is no historical seed/backfill. The worker selects only immutable committed source events strictly later than the current enabled revision. It uses the same latest-non-ATTACH stage/recipient rules as the in-app inbox: head REPORT/SUBMIT; assigned technician ASSIGN/SCHEDULE/INVESTIGATE/RETURN. ATTACH preserves the handoff. Work start/approval/closure/reassignment/return/resubmission revoke obsolete deliveries. RCA drafting never emits handoffs. Each organization/machine/user/role/event/preference revision has one outbox identity; repeated polls/concurrent enqueue use a unique constraint and ON CONFLICT. Source/workflow/audit rollback cannot produce a phantom email source. In-app read status is independent.

Enqueue and claim recheck current role/grant, WH-C scope, current assignment/actionable latest event, and latest enabled preference/destination. A second short transaction rechecks immediately before the provider call. No transaction spans provider HTTP. Disabling/changing destination atomically suppresses pending or leased records. The worker does not start in NODE_ENV=test, without database/provider config, or with the feature flag off. Configured startup only arms a 30-second interval; each tick enqueues at most 100, recovers at most 20 expired leases and processes at most one send. Multiple replicas use SKIP LOCKED and a 90-second token lease. HTTP is fixed `https://api.resend.com/emails`, 8-second timeout, no redirects, bounded response body. Retryable network/429/5xx/concurrent-key failures back off 30/60/120/240/480 seconds (honoring numeric Retry-After up to one hour); other provider rejections are terminal. At most six claims and a 20-hour first-attempt horizon are permitted. Crashes reclaim the same durable identity and exact persisted JSON body, including original sender and links.

Resend documents a 24-hour idempotency-key lifetime, so the 20-hour cutoff deliberately leaves margin. A crash after acceptance/before persistence can replay only within that horizon. Expired uncertain deliveries become terminal rather than being resent beyond the provider window. This is not an exactly-once guarantee or evidence that an inbox received/read a message. SENT means provider accepted; no webhook/bounce/read tracking is claimed. A terminal failure has no browser resend action: a new handoff must occur or an authorized maintainer must investigate privately. Retrying the settings save or status refresh never retries a terminal message.

There is an unavoidable race after the final database check and before/during external HTTP: a role can be revoked, work can advance, or a user can disable email after the request has begun. Cancellation cannot retract an accepted email. Late provider results after a cancellation/lease replacement are retained separately as immutable attempt evidence; the queue's cancellation state remains retained. A single original provider request can continue through a process crash despite the timeout; provider idempotency reduces duplicate risk within its documented window. Keeping the same provider account/API-key scope through retries is an operational prerequisite.

Auth email changes outside the settings workflow are not independently observable by this background worker: only public Supabase Auth credentials are available and no bearer/admin credential is retained. Delivery uses the explicitly opted-in confirmed-address snapshot until that user saves a new verified destination or disables. The next enable/reverify gets current Auth data and never redirects an old queued payload. Revoked application access still suppresses sending independently. Contact changes, provider bounces and long-term retention policy remain operational limitations to communicate before enabling email.

Minimal fixed email content includes only action, immutable order UUID, event time in IST, the authenticated work-order link and preference link. No title, symptoms, attachments, human RCA or AI diagnoses are sent. Provider errors/logs store fixed safe codes; secrets, raw responses and addresses are absent from audit/log/error text. Payload/destination are private recipient data in the restricted database.

References checked 27 October 2026: [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [Resend send email](https://resend.com/docs/api-reference/emails/send-email), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys). The relevant Supabase changelog TLS notice concerns older cipher support; the existing Node HTTPS verifier remains enabled.

## Verification

Implementation agent ran **23 unit/provider-double tests**, all passed, plus strict API/web/browser-test TypeScript checks. The final dedicated browser run passed **32 cases (16 desktop + 16 mobile)**. Tests cover confirmed-contact mismatch/failure, strict self-only intent, all supported and unsupported roles, JSON Content-Type, no startup/configless delivery, safe payloads/errors, idempotency/retry HTTP behavior, save/conflict/expiry failures, recipient-only destination, delivery/late-attempt status, source links, keyboard interaction and narrow layout. Browser tests use intercepted Auth/API fixtures only. No real provider request or operational acceptance write occurred.

Parent ran the complete isolated database suite after rehearsal; `.local/feature-work-20261027/first-full-db.log` records **all 17 external-email integration cases passing**. That combined run had one unrelated RCA assertion failure; this feature does not claim the entire combined suite passed. Email cases exercise actual trusted guards/records and HTTP PUT JSON, enrollment cutoff, separate heads/roles, reassignment/revocation, ATTACH, planned/investigation releases, read-receipt independence, concurrent enqueue/claim/save, payload-preserving retries, lease recovery, exhausted/horizon terminal states, disable/send race with late evidence, missing configuration, runtime SQL restrictions and atomic preference/enqueue/result audit rollback. Time/lease fault injection is restricted to the isolated owner fixture transaction; runtime protections remain active outside it. This implementation agent did not run DB suites or apply migrations.

Migration 021 is frozen. SHA-256 `e188cf21e0bda7019c84a3d95dffb2a3290dd01669167854f2bc71703fd47769` matches the parent's isolated rehearsal fingerprint. Parent owns `docs/VERIFICATION.md`, shared registration/configuration/OpenAPI/Prisma model mirroring/grants and all hosted migration decisions. No commits, push, deployment or new Auth account/grants were performed by this agent.

Dedicated browser command (does not use port 3100):

```sh
npx playwright test --config tests/browser/external-notifications.playwright.config.ts
```

`external-notifications-server.mjs` copies only application source/configuration into ignored `.local/external-notifications-web`, then starts the normal Next CLI on port 3121. Cache and generated types stay inside that copy; no .env/company files are copied. Results/screenshots stay in `.local/external-notifications-browser-results`. Next 16's custom-server path ignored `conf` in the first attempted harness, so that run was stopped before feature verification and replaced with this separate CLI project. The first complete feature run passed 30/32, exposing a test locator selecting the shell's Work orders link; it was corrected. A React key collision found in the fixture was also fixed. The final complete run passed 32/32 without that warning. A subsequent 2/2 opt-in replay captured enabled-state screenshots at desktop and mobile sizes; both were visually inspected for readable controls, correct destination/IST cutoff and responsive wrapping. The native T3 browser checked the real unauthenticated route and observed the expected login redirect; authenticated live UI/provider acceptance remains unperformed.

## Owner setup and role workflow

1. Create a Resend account. For a pilot test sender, use the same account email as the confirmed Maintenance login; Resend restricts test-sender recipients to that account. For staff recipients, verify a domain you own using the DNS records shown by Resend.
2. Create a Maintenance API key with **Sending access**, preferably restricted to the verified domain. Save it privately in root `.env` as `RESEND_API_KEY`, never in frontend settings/chat/Git. Set `NOTIFICATION_EMAIL_PROVIDER=resend` and `NOTIFICATION_EMAIL_FROM` to the verified sender (or `onboarding@resend.dev` for account-only testing). Keep `EXTERNAL_NOTIFICATIONS_ENABLED=false` until deliberate activation.
3. After backend configuration is ready, set the flag true and restart `npm run dev`. This alone enrolls nobody and sends no old handoffs. Each active Technician or Maintenance head opens **Email alerts**, enables its own preference and saves; Supabase verifies that person's confirmed email.
4. Future operator reports notify enrolled heads; assignment/planned/investigation release and return notify the currently assigned enrolled technician; submission notifies enrolled heads. The user follows the link, signs in with the appropriate trusted role and performs the normal workflow. Current pilot links point to localhost and are usable only where that local app is reachable.
5. Refresh delivery activity for queued, provider-accepted, failed/suppressed states and immutable attempt history. Disable affects that actual identity/role only. Operator, Supervisor, Management and Administrator do not receive these engineering handoff emails or manage another person's preference.

Observed final verification: 23 focused unit/provider tests, 17 isolated database cases and 32 desktop/mobile feature cases passed. Combined suites passed 142 unit/script, 169 PostgreSQL integration and 344 browser tests, with strict TypeScript, production build and zero-vulnerability audit. The browser tests assert the JSON Content-Type on save and wait for initial settings before simulating expiry/failure. Provider HTTP behavior was tested with deterministic doubles. The owner-supplied key and pilot sender are now saved only in the ignored backend environment; configuration validation passed, but this does not validate the key with Resend. Global sending remains disabled. No real Resend send/inbox acceptance has occurred; a recipient/account confirmation and explicit test-message authorization are pending.

Setup references: [Create a Resend API key](https://resend.com/docs/create-an-api-key), [verify a domain](https://resend.com/docs/dashboard/domains/introduction), [test-sender restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

### Authorized pilot send — 27 October 2026

After the owner explicitly confirmed the recipient and Resend account email, one test message from `onboarding@resend.dev` was sent through the actual application provider adapter. Resend accepted it and returned a message ID. The fixed message states that no work order was created; none was created. A private pre-call request record prevents an accidental repeat of the probe. Inbox receipt remains for the owner to confirm. The global worker flag remains false, and no preference, outbox row or operational handoff was created. This supersedes the preceding provider-acceptance-pending status only; automatic operational delivery remains unverified and disabled.

### Operational enablement — 27 October 2026

Investigating the owner's newly created report with no email confirmed the global flag was still false, with zero preference and outbox rows. Enabled the configured pilot email worker and restarted development serving. Read-only Maintenance-head settings now return configured=true, enabled=false and zero deliveries. Each recipient must still enable and save their own active-role preference in Email alerts; no enrollment was manufactured and no existing event was backfilled. The worker checks every thirty seconds, so eligible future handoffs are asynchronous. The account-only pilot sender restriction remains. This supersedes the preceding globally-disabled status; actual operational handoff acceptance still awaits recipient opt-in and a subsequent eligible event.
