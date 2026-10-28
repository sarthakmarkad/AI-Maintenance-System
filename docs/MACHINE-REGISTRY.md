# Organization machine registry

The platform supports actual machines registered by an organization's Administrator. WH-C remains the original pilot; standard machine-specific Excel templates now support production and synthetic readings on every registered machine; its model is unknown. WH-B remains reference-only. Registering another machine starts an empty workspace with no fabricated incidents, schedules, operating limits, telemetry or production records.

## Workflow

1. Sign in and select the trusted **Administrator** role. Open **Asset registry → Add machine**.
2. Enter a unique machine code and a descriptive machine name. Manufacturer, model, department and location are optional. Codes are saved uppercase and allow letters, digits and hyphens, up to 32 characters. The API accepts uppercase only. Codes are unique within each organization; matching codes in another organization do not share records. WH-B is reserved as reference-only.
3. **Create machine workspace** opens its overview. Unknown metadata remains absent. Registration alone makes no live-health claim.
4. Use **Manage machine access** to grant existing Operators/Technicians access. The list includes primary roles and current additional operational role grants, and supports name search/paging. A multi-role identity still needs an explicit machine grant to use its Operator/Technician views. This form creates no accounts or role grants.
   **Edit machine** on the registry card or overview changes its name, manufacturer, model, department, location and current photo. Optional unknown details can stay blank; the machine code stays fixed. The photo appears on both the registry and overview and is read through authenticated machine access. See [editing and photos](MACHINE-EDITING.md).
5. The Operator can report an issue. A head assigns an eligible machine-granted technician, who starts and submits findings. A head reviews; head/supervisor closes approved work. Planned maintenance, private evidence, approved manuals/SOPs, reports, notifications and the assistant use that machine's existing scoped workflows.
6. Operators/Technicians see only machines granted to their memberships. Heads, Supervisors, Management and Administrators see organization machines with their existing role-specific powers. Switch machines through the Asset registry; server-side code/name search and keyset paging support more than the original first page.

Administrator registers equipment and controls access; it remains unable to report as Operator, repair as Technician, approve as Head or close as Supervisor. Those actions require the separately trusted active role. Machine access does not combine role authority.

## Access changes and conflicts

Changes apply to selected people only, preserving unlisted/off-page grants. The UI retains choices across close/reopen, locks search while changes are pending, and reloads only on deliberate request or a new search. Inactive/revoked-role people with existing grants remain visible for revocation. New grants require active organization membership and a current Operator or Technician grant. No foreign membership may be selected.

Each save checks the machine's current access version under a short machine-row lock. Competing intents permit only one version. The same request/body returns its original receipt without a second audit/version increment; changed input under a used retry key conflicts. After an uncertain success or version conflict, reload and review the current list. Revocation blocks later scoped access while retaining existing work, files and audit evidence. A head may need to reassign unfinished work; removing access does not complete or cancel it.

## Persistence and API

- `POST /api/machines`: Administrator-only, strict metadata plus UUID requestId. Membership/selected role are rechecked in the transaction; organization and registry state come from the server. Organization/request advisory lock serializes retries. Organization/code uniqueness resolves racing registrations. Exact retry returns the registered machine; changed retry conflicts.
- `GET /api/machines?limit=&after=&q=`: all six roles, existing scope, code/name search and ascending code keyset pagination, 25 default/100 maximum per page.
- `GET /api/machines/:code/access?limit=&after=&q=`: Administrator-only, active eligible or previously granted people, name search, stable membership-ID paging, current version.
- `PUT /api/machines/:code/access`: Administrator-only, UUID requestId, expected version and up to 100 distinct `{membershipId,granted}` changes.
- `MACHINE_REGISTER` and `MACHINE_ACCESS_UPDATE` audits commit atomically with registry/access changes. Registration and access audit failures roll back all associated writes, including newly created department/location records.
- Migration 023 permits nullable manufacturer and adds registration receipt fields/access version to the existing machine table. Existing IDs, metadata and associations stay intact. Migration 026 adds the private current-photo table. Runtime can insert registry/department/location/access rows, update the five editable metadata fields plus version/updatedAt, and delete machine-access associations/current display photos. Memberships, roles, immutable machine identity/code, photo-byte UPDATE and protected evidence remain outside runtime mutation grants. Metadata/photo changes require Administrator service authorization and atomic audit; no engineering permissions are added.
- Migration 025 explicitly requires a non-null valid hash whenever a registration key is present, including SQL three-valued-check edge cases.
- Migration 024 generalizes notification receipt/access functions and the new-email subject check, preserving scope, live grants, event actionability, immutable payloads and opt-in cutoffs. New email templates use the actual registry machine code, checked against the outbox's machine. No enrollment or historical-email backfill is seeded.

The private Supabase `maintenance` schema remains inaccessible to browser database roles. The browser uses authenticated NestJS routes. Existing queued payloads and existing RCA snapshots are retained as originally captured; newly created email/RCA evidence uses the actual selected machine.

## Current limits

Registration includes creation, metadata/current-photo editing and operator/technician access management. Administrator archive/restore is implemented with versioned audit and outstanding-work safeguards; see RECORD-REMOVAL.md. Code renaming, permanent deletion and staff account provisioning remain separate workflows. Equipment types are represented by the descriptive machine name; no guessed model/category taxonomy is imposed. Live telemetry and machine-specific engineering limits require a separately verified integration. Registry photos describe current equipment presentation; they do not replace immutable work-order evidence.

Production and Process trends are available for every registered machine. Importers can download a blank machine-specific production or synthetic process-reading template from the corresponding popup. The compact production format stores kg output/scrap and preserves job grain/daily controls; the existing monthly layout is also supported when its heading matches the selected machine. The process template retains the existing synthetic three-parameter demonstration profile. Other units/parameters/layouts require an explicit mapping; nothing is guessed. Existing statistical flags retain synthetic provenance and never auto-create incidents. See STANDARD-EXCEL-TEMPLATES.md.

See VERIFICATION.md for isolated tests, hosted migration/content checks and browser acceptance limits.
