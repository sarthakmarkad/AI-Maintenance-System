# Individual staff accounts and team management

Administrators manage **Team** at `/team`. Each newly invited person signs in with their own Supabase identity and receives one trusted application role plus explicit machine access where required. Existing maintenance history and the original multi-role pilot are preserved.

## Workflow

1. Sign in as Administrator and open **Team → Invite staff**. Enter the person's name and actual email, select their role, and choose machines for an Operator or Technician. Other roles retain organization-wide scope.
2. Create the invitation. It lasts seven days and grants no access until accepted. Share its private link directly. **Send email** is a separate, confirmed action and is disabled until a verified Resend sender is configured. An invitation can be revoked; expired/revoked links cannot enroll anyone.
3. The person opens the link and authenticates using the **invited email**, through Google or an existing confirmed password account. New password signup becomes available after custom SMTP is configured. They explicitly select **Accept invitation**. Supabase's confirmed email and UUID must match; browser-supplied email/role information cannot grant access.
4. Their account opens the asset registry with only the assigned role and permitted machines. Technician assignment menus use the actual new staff identity; no Administrator engineering powers are added.
5. Administrator can **Manage** another staff member: edit name, change their single role, adjust machine access, deactivate or reactivate, and enter a reason. Existing extra pilot grants require explicit replacement. A stale staff or machine-access snapshot must be reloaded before saving.
6. Deactivation blocks subsequent application requests even with a retained Auth session. It does not delete the Supabase identity, erase evidence, reassign unfinished orders/plans, unsubscribe the person's email preference, or revoke unrelated external services. The Maintenance head must review affected assignments. Reactivation is explicit and retains the same identity/history; an old invitation cannot reactivate an account.

The user's own account cannot be edited here. Another active Administrator must manage it. At least one Administrator must remain active. Add and verify a second real Administrator before attempting account handover.

## Role responsibilities

| Role | Staff feature activity |
|---|---|
| Administrator | Invite/revoke, share or explicitly email links, edit other staff roles/machines, deactivate/reactivate. Cannot approve engineering work. |
| Operator | Accept own invitation; report issues on granted machines. Cannot manage staff. |
| Technician | Accept own invitation; start/submit own assigned work on granted machines. Cannot manage staff. |
| Maintenance head | Accept own invitation; assign/reassign technicians and approve/return engineering work within existing workflow. Cannot administer accounts. |
| Supervisor | Accept own invitation; close approved work within existing permissions. Cannot administer accounts. |
| Plant management | Accept own invitation; inspect scoped records. Cannot administer accounts. |

Existing engineering permissions remain in [TEAM-ACCESS.md](TEAM-ACCESS.md). Single-role staff do not see a role selector with ungranted roles. Machine access applies to all machine content, including documents, imports and chatbot history. New people must explicitly opt into external handoff emails for themselves; accepting an invitation never enrolls them or backfills earlier alerts.

## Setup: current local installation

The backend needs a persistent `TEAM_INVITATION_SECRET`: 32 random bytes represented as 64 hexadecimal characters, stored privately in root `.env`. It signs private links; the database retains only a token hash. Back up this key privately. Changing it requires revoking/reissuing outstanding links before resharing them. No Supabase service-role/admin key is required.

`TEAM_PASSWORD_EMAIL_READY=false` keeps new password signup and recovery requests disabled until the sender is tested. Existing email/password login remains available. This readiness setting is a deliberate local assertion, not a live query of Supabase's dashboard settings.

The existing `onboarding@resend.dev` sender is account-only and is **not** sufficient for inviting staff. Work-order email configuration is separate and remains unchanged until the owner chooses a verified replacement sender.

### Verify a Resend sending domain

1. Use a domain you control, for example a dedicated sending subdomain such as `mail.your-company.example`. Add it under **Resend → Domains**.
2. Add the exact DNS verification records Resend shows at your DNS provider. Wait until Resend reports the domain is verified. Use the displayed records rather than inventing SPF/DKIM values or replacing unrelated existing records.
3. Choose a sender on that verified domain, for example `maintenance@your-company.example`. Create/use a Resend sending API key authorized for that domain. Keep it private; never put it in frontend settings or chat.

### Configure Supabase Auth SMTP

Open the [Maintenance project's SMTP settings](https://supabase.com/dashboard/project/atfjdjliclqzzapetnrr/auth/smtp) and enable **custom SMTP**:

| Setting | Value |
|---|---|
| Sender email | Your verified-domain address |
| Sender name | Maintenance |
| Host | `smtp.resend.com` |
| Port | `465` (TLS), as documented by Resend |
| Username | `resend` |
| Password | Your Resend API key, entered privately in Supabase |

Keep email confirmation enabled under Supabase's Email provider settings, and allow new email signups if staff will create password accounts. Creating an Auth identity alone grants **no application membership**. Preserve the app's Google provider and existing approved identities.

Set Auth **Site URL** to `http://localhost:3000` for this local installation. Preserve and allow `http://localhost:3000/auth/callback`. The installed SDK appends `sb_flow_id` for PKCE flows; test that the allowlisted callback accepts the generated query. Change URLs deliberately when deploying; localhost is local to the person opening a link. Staff on other computers need an approved reachable application URL and matching Auth/Google redirects before using it remotely. No deployment is included here.

Keep the built-in confirmation/recovery templates' `{{ .ConfirmationURL }}` links intact. Confirmation and recovery must be opened in the initiating browser so its PKCE verifier is available. Missing/expired verifiers fail closed; request a new link from that browser. SMTP configuration does not supply Google access for test audiences: if Google OAuth remains in Testing, add each actual staff address to Google's authorized test users as described in [GOOGLE-SIGN-IN-SETUP.md](GOOGLE-SIGN-IN-SETUP.md).

After saving SMTP, use a **real intended staff/test recipient authorized by the owner** to check confirmation and recovery delivery, including spam folders. Confirm that account confirmation returns to the pending invitation, and that password recovery opens **Set a new password**, saves a strong password and allows a fresh login. Keep `TEAM_PASSWORD_EMAIL_READY=false` until these real checks pass; then set it to `true` privately and restart the backend. The automated fixture checks are not proof of inbox delivery.

For application invitation emails, separately set backend `RESEND_API_KEY`, `NOTIFICATION_EMAIL_PROVIDER=resend`, `NOTIFICATION_EMAIL_FROM=<verified-domain sender>`, and `EXTERNAL_NOTIFICATIONS_ENABLED=true`, then restart. This also changes the existing work-order sending configuration; review the sender before changing it. The Team page enables **Send email** only when these settings are complete and the sender is outside `resend.dev`.

References verified during implementation: [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Resend with Supabase SMTP](https://resend.com/docs/send-with-supabase-smtp), [Supabase password flows](https://supabase.com/docs/guides/auth/passwords).

## Password recovery

**Login → Forgot your password?** sends a Supabase recovery request only after SMTP readiness is enabled. Its generic success response does not disclose whether an address exists. Supabase controls provider rate limits and email delivery. The callback exchanges the single-use PKCE code once; `PASSWORD_RECOVERY` routes directly to `/reset-password` without requiring a workspace membership first. Password updates verify the authenticated Supabase user, require matching passwords of at least 12 characters and request global sign-out after saving. A temporary invitation lookup outage after sign-in offers a workspace-check retry without re-exchanging the consumed code. An already-issued access token may remain valid until expiry; application deactivation is the immediate application-access control.

Neither the Administrator nor the app receives staff passwords. Password recovery does not change roles, machine grants, deactivated status or work-order ownership. Email changes are not implemented in Team; an existing staff account must be reviewed rather than duplicated under a new invitation.

## Persistence and security boundaries

Migrations 032–034 add invitation/receipt/delivery tables and member CAS/email fields. Owner-managed SQL functions execute in the private `maintenance` schema with a fixed search path, explicit scoped checks and revoked PUBLIC/browser/service-role execution. The restricted API role receives only these narrow function executions; it cannot directly write identity/membership/grant/team tables. Verified Auth UUID, confirmed contact and selected trusted Administrator authority are derived by NestJS. Internal SQL actor parameters are trusted API inputs, never a browser SQL endpoint.

Organization serialization, machine/member locks, exact version plus machine snapshots, immutable action receipts and matching atomic audit protect concurrent edits and retries. Acceptance checks expiry, confirmed email, current inviter authority and one existing membership per identity. It cannot move an existing identity between organizations or replace its privileges. Changing/deactivating an Administrator revokes their pending invitations when Administrator authority is removed. Expired invitations remain as history; a new invitation for the same email retires the prior expired one with audit.

Link tokens are fragment-only, removed from browser history on load and not persisted in browser storage. Signed-in recipients can rediscover their own pending invitation from their provider-confirmed email after OAuth/email confirmation. A single email may have invitations from different organizations, but an identity can accept only its first workspace membership under the current schema. Listings are bounded to 25 records per page; onboarding discovery shows at most 25 newest matching pending invitations. Invitation details make bounded per-item lookups (up to three each), which should be batched if organizations grow substantially.

Public onboarding checks have an in-process 60/minute/IP limit and a bounded map; deployment across multiple API instances requires shared rate limiting and reviewed proxy configuration. Supabase Auth adds its own authentication/email limits. The app does not claim an organization-wide account-creation abuse prevention system; configure provider CAPTCHA/rate controls before public deployment.

Invitation sending reserves a durable receipt and audit before calling Resend. Exact retries return its retained status and do not call the provider again. Limits are 30 email reservations/org/hour and one per invitation per two minutes. A crashed/timed-out send can remain PENDING or UNCERTAIN; review its provider status before explicitly resending with a new request. No automatic invitation retry worker is implemented; the stored lease timestamp is reserved metadata. An already-started email cannot be recalled when an invitation is revoked. Provider acceptance is not confirmation of inbox delivery.

## Verification

Tests use isolated `_test` PostgreSQL, real restricted runtime grants and API HTTP calls. Browser contract tests intercept only test Auth/API fixtures; full system journeys use the real API/database with Auth identity/contact test doubles confined to `tests/system`. Real staff enrollment, actual SMTP inbox delivery, remote access and new Google-user consent require configured owner accounts; no invented operational staff or real messages are created by this verification. Actual results and remaining limits are recorded in [VERIFICATION.md](VERIFICATION.md).
