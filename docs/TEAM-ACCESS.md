# Team authentication and role views

All six roles use the same Supabase authentication mechanism. Email/password or Google proves identity; NestJS verifies the Supabase user UUID and loads trusted application membership and role grants. No login role selector, email domain, Google profile, JWT metadata or browser setting can create privileges.

The user explicitly requested one existing Gmail identity for all roles. The pilot therefore keeps its existing Administrator default membership and adds five explicit MembershipRoleGrant records. Active role selects exactly one granted view. This is one account with six authorized roles, not six separate Supabase users with a duplicate email. No aliases or new passwords were created.

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

Management has read-only access, including the maintenance performance dashboard; validated equipment reliability analytics remain pending. Administrator does not inherit engineering powers. An identity deliberately granted both Administrator and Maintenance head can act as a head only while that separately granted role is active. The pilot user can therefore perform several responsibilities sequentially; this does not provide independent-person approval separation. Production use should provision individual staff identities and grant only their actual responsibilities.

## How selection is enforced

- Membership.role stays the default. Additional grants have organization-scoped foreign keys, unique membership/role pairs and an active flag. Existing single-role accounts continue to work unchanged.
- `/api/me` returns the active role and server-derived availableRoles. The browser offers only those roles, validates the new selection through `/api/me`, and opens a fresh registry workspace to discard prior-role forms.
- Selection is stored per browser tab and user UUID. API requests send `X-Workspace-Role` as a request to use a role. AuthGuard validates its enum and verifies the role against current trusted grants on every request; an ungranted or revoked role returns 403. No header means the default role. Unknown headers such as `x-role` remain ignored.
- Grants do not combine permissions. An account granted all six roles still cannot approve in its Administrator or Supervisor view. The work-order transaction rechecks the selected grant, active membership and machine access, and records the actual acting role in immutable action history and audit metadata.
- Eligible technicians include active primary technicians and active technician-role grantees, always requiring machine access. This lets the same pilot identity be assigned work without giving its Administrator view repair authority.
- Sign-out and a fresh explicit login clear selection. A revoked view can return to the default through the workspace error screen. Revoked primary membership denies all views.
- Runtime database credentials cannot create/change/delete role grants. The migration grants no browser table access. No user-facing privilege editor or self-enrollment endpoint was added.

Trusted owner provisioning for an already verified existing Auth UUID:

```sh
npm run db:grant-roles -- <verified-Auth-UUID> OPERATOR TECHNICIAN MAINTENANCE_HEAD SUPERVISOR MANAGEMENT
```

The command retains the default role, grants WH-C access when required, appends an immutable audit event with the new roles and does not duplicate grants on repeat. It refuses to silently reactivate revoked grants. Owner access and a verified target identity are required. Individual future users can still be provisioned through `db:provision` with one role.

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
