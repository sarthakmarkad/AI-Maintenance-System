# Team authentication and role views

All six roles use the same Supabase authentication mechanism. Email/password or Google proves identity; NestJS verifies the Supabase user UUID and loads trusted application membership and role grants. No login role selector, email domain, Google profile, JWT metadata or browser setting can create privileges.

Each protected request verifies identity with Supabase `getUser`; no cached identity or decoded-claim fallback admits a request during an outage. A temporary network/5xx failure permits one retry of this read-only check, with two four-second attempts retaining the eight-second maximum. Invalid sessions reject immediately; a 429 returns service unavailable without an immediate retry or forced logout. The protected operation itself is never automatically replayed. Trusted application membership, selected role and machine scope are still checked after successful verification.

The original pilot explicitly uses one Gmail identity for all roles and keeps its existing Administrator default membership and adds five explicit MembershipRoleGrant records. Active role selects exactly one granted view. This is one account with six authorized roles, not six separate Supabase users with a duplicate email. No aliases or new passwords were created.

## Current access matrix

All views read records only within their organization. Operators and technicians additionally require a machine grant. Work-order repair actions also require the assigned technician's UUID.

| Active role | Import production/readings | Report an issue | Assign/reassign | Repair/start/submit | Approve/return | Close approved work |
|---|---|---|---|---|---|---|
| Operator | No | Yes | No | No | No | No |
| Technician | No | No | No | Assigned work only | No | No |
| Maintenance head | Yes | No | Yes | No | Yes | Yes |
| Supervisor | Yes | No | No | No | No | Yes |
| Plant management | No | No | No | No | No | No |
| Administrator | Yes | No | No | No | No | No |

Management has read-only access, including the maintenance performance dashboard; validated equipment reliability analytics remain pending. Administrator does not inherit engineering powers. An identity deliberately granted both Administrator and Maintenance head can act as a head only while that separately granted role is active. The pilot user can therefore perform several responsibilities sequentially; this does not provide independent-person approval separation. New staff now join through Administrator-created invitations with individual verified identities and only their actual responsibilities. See [STAFF-MANAGEMENT.md](STAFF-MANAGEMENT.md). The existing pilot grants are retained until the owner explicitly retires them.

## How selection is enforced

- Membership.role stays the default. Additional grants have organization-scoped foreign keys, unique membership/role pairs and an active flag. Existing single-role accounts continue to work unchanged.
- `/api/me` returns the active role and server-derived availableRoles. The browser offers only those roles, validates the new selection through `/api/me`, and opens a fresh registry workspace to discard prior-role forms.
- Selection is stored per browser tab and user UUID. API requests send `X-Workspace-Role` as a request to use a role. AuthGuard validates its enum and verifies the role against current trusted grants on every request; an ungranted or revoked role returns 403. No header means the default role. Unknown headers such as `x-role` remain ignored.
- Grants do not combine permissions. An account granted all six roles still cannot approve in its Administrator or Supervisor view. The work-order transaction rechecks the selected grant, active membership and machine access, and records the actual acting role in immutable action history and audit metadata.
- Eligible technicians include active primary technicians and active technician-role grantees, always requiring machine access. This lets the same pilot identity be assigned work without giving its Administrator view repair authority.
- Sign-out and a fresh explicit login clear selection. A revoked view can return to the default through the workspace error screen. Revoked primary membership denies all views.
- Runtime credentials cannot directly create/change/delete identity or role grants. Administrator-only Team management uses narrow private audited SQL functions, and first membership requires an explicit valid invitation plus a matching confirmed Supabase identity. Browser database access and self-assigned privileges remain denied.

Trusted owner provisioning for an already verified existing Auth UUID:

```sh
npm run db:grant-roles -- <verified-Auth-UUID> OPERATOR TECHNICIAN MAINTENANCE_HEAD SUPERVISOR MANAGEMENT
```

The command retains the default role, grants WH-C access when required, appends an immutable audit event with the new roles and does not duplicate grants on repeat. It refuses to silently reactivate revoked grants. Owner access and a verified target identity are required. The CLI remains an owner-only provisioning fallback; normal staff enrollment now uses **Team → Invite staff** with one role.

## Google and verification boundary

The frontend uses a PKCE browser flow with explicit callback exchange; there is no extra password endpoint or auth bypass. Callback credentials are removed from the URL, external `next` redirects are ignored, and provider error text is not rendered. Missing verifier, cancellation, expired code, unavailable API and unprovisioned identity paths fail closed. Retrying a workspace check does not exchange a single-use code twice.

Google availability is read from Supabase's public settings; the button remains disabled while the provider is not configured. Email login stays available. See [GOOGLE-SIGN-IN-SETUP.md](GOOGLE-SIGN-IN-SETUP.md) for the exact project/origin/redirect configuration and repeatable setup instructions. Google authentication does not provision or alter application grants.

Real PostgreSQL HTTP tests exercise one identity through all six views, a complete workflow, import allow/deny checks, acting-role history, forged and revoked roles and machine revocation. Browser tests exercise PKCE and role-switch UX with fixtures. The owner has now configured Google OAuth and reports checking the login. Hosted provider availability and redirect to Google were independently observed; the agent stopped before completing Google credentials/consent at the user’s request. Completed callback identity/linkage was not independently inspected.

## Calendar permissions (M5)

All six views read the scoped calendar. Only Maintenance head creates/pauses/resumes plans, releases assigned planned work orders or skips unreleased occurrences. Heads/supervisors see scoped actionable reminders; technicians see reminders for their assigned work, and read receipts are separate per identity/role. Administrator has no calendar management authority. Planned work still requires assigned-technician completion, head review and supervisor/head approved closure. See CALENDAR.md.

## Statistical pattern permissions (M6)

All six roles can inspect scoped synthetic pattern evidence and saved review history. Only the active Maintenance head view can record an investigation/dismissal decision with a required reason. Supervisor and Administrator have read-only access. The server recalculates submitted evidence keys, preserves the actual actor/role and writes review/audit atomically. No statistical flag creates an incident or grants repair/approval authority. See STATISTICAL-PATTERNS.md.

## Investigation handoff

Only active Maintenance head can release an investigation from a saved INVESTIGATE review and select an eligible technician. All scoped roles can see the link/status and retained evidence. Assignment to a multi-role pilot identity does not grant Administrator repair powers: select Technician to start/submit that user's assigned work. Head alone approves/returns; head or supervisor closes approved investigations. Historical review release uses the same trusted scope checks even when the analysis worker is unavailable. No new grants or permission unions are introduced.

## Maintenance performance permissions (M7)

All six roles can read Maintenance performance within their existing machine/organization scope; operators/technicians still require explicit machine access. Technician's own open-assignment count uses the verified identity. The dashboard has no operational mutation endpoint or controls: links open existing pages, where current trusted role, assignment, state and version checks decide allowed actions. Head manages assignments/review, supervisor closes approved work, operator reports, technician handles own assignments, management inspects, and Administrator remains without engineering authority. Definitions and the complete role workflow are in MAINTENANCE-PERFORMANCE.md.

## Attachment permissions (M8)

All six roles can download work-order photos/PDFs within existing machine/organization scope. Only the reporting Operator on REPORTED work or the assigned Technician on IN_PROGRESS work can upload. Other technicians/operators, Maintenance head, Supervisor, Management and Administrator do not upload. Review requires a stable evidence set: submitted/approved/closed work is read-only for attachments; head return enables assigned-technician additions. Upload/download recheck current trusted access, including revocations. No new grants or role unions are introduced. See ATTACHMENTS.md.

## Maintenance report permissions (M9)

All six active roles can preview/export PDF/Excel reports within their existing organization/machine read scope; Operator/Technician still require explicit machine grants. Individual exports require the displayed order version. Source transactions and post-render delivery both recheck live trusted access; forged/revoked roles and foreign records cannot receive report bytes. Export audit uses existing protected append permissions and grants no operational/engineering authority. See REPORTS.md for role activity and acceptance boundaries.

## Work-order notifications and approved references (M10–11)

Active Technician receives current assignment/release/return handoffs only for its own assignments and explicit machine grants; active Maintenance head receives unassigned operator breakdown reports and pending-review submissions in organization scope. Other active views have no personal engineering handoffs. Read receipts are separate by actual identity/active role and never change work-order versions. Calendar reminders stay independent. See WORK-ORDER-NOTIFICATIONS.md.

All six scoped roles browse/download current approved machine PDFs. Only Administrator and Maintenance head manage drafts and inspect obsolete file/history evidence; only the active Maintenance head approves or withdraws with a reason. Administrator has no approval authority. Draft uploads preserve the current approval, and withdrawal does not silently restore older files. Selected grants and scope are rechecked for metadata, mutations and private downloads; no new accounts or grants are provisioned. See DOCUMENT-LIBRARY.md.

## Approved-document assistant — 24 October 2026

All six active role views can use general chat and ask questions from current approved, indexed WH-C references within existing trusted scope. Head/Admin can retry failed indexing; Administrator still cannot approve documents or engineering work. No new Auth identities or grants are introduced. Draft/withdrawn/superseded files are excluded from retrieval. Details, provider disclosure, observed live-provider checks and remaining limits: [DOCUMENT-AI.md](DOCUMENT-AI.md).


## Organization machine registry — 28 October 2026

Only the active Administrator view registers machines and grants/revokes machine access for existing organization Operators/Technicians. This does not provision users or roles and grants no engineering approval powers. Operator/Technician machine grants are explicit, including for the multi-role pilot identity; the head can assign only current machine-granted technicians. Heads, Supervisors, Management and Administrators retain organization-wide read scope with their existing distinct action permissions. Revocation denies subsequent machine/workflow/document/assistant/notification reads and actions while preserving original history and assignments. A head may need to reassign unfinished work after access is removed. See [MACHINE-REGISTRY.md](MACHINE-REGISTRY.md).

## Machine details and registry photos — 28 October 2026

The active Administrator view can edit registry name/manufacturer/model/department/location and upload, replace or remove a current machine photo. Codes and original maintenance evidence remain unchanged. All six currently scoped role views can read the current photo through authenticated endpoints; Operators/Technicians still require machine grants. Replacement invalidates the previous photo URL, and each new read checks live membership, selected role and machine scope. No accounts, role grants or engineering powers are added. [MACHINE-EDITING.md](MACHINE-EDITING.md) describes version conflicts, audit and file handling.


## Removal and archival

Administrator alone archives/restores machines, with a reason, version checks and audit. Open work and scheduled obligations must be resolved first by their existing operational roles. Maintenance head alone cancels pre-approval work orders of every kind with a reason; Administrator gains no engineering authority. Every role may remove only its own actual-user/active-role conversations within machine scope. Archived machine history stays scoped and readable while operational writes are rejected; personal email opt-out and own-conversation removal remain allowed. See RECORD-REMOVAL.md.


## Individual staff management — 29 October 2026

Administrator now manages individual staff invitations, roles, machine scope and deactivation/reactivation at `/team`. New people prove their confirmed invited email using Supabase before explicitly accepting. Acceptance cannot replace an existing membership, union roles or reactivate a disabled account. Staff changes preserve UUIDs, maintenance evidence and existing assignments, with versioned snapshots and immutable audit. Deactivation denies later requests despite a retained Auth session; the head remains responsible for reassignment. An Administrator cannot edit their own access or gain engineering approval. Existing pilot grants remain unchanged.

Password signup/recovery are implemented but disabled until the owner verifies a Resend domain and configures/tests Supabase SMTP. Google and existing confirmed password accounts can accept directly shared links meanwhile. Invitation email sending is separately gated to a verified-domain sender. Setup, exact role activity and limits: [STAFF-MANAGEMENT.md](STAFF-MANAGEMENT.md).
