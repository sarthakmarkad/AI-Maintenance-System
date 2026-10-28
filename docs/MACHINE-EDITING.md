# Machine metadata and private registry photos

Task 2 implementation handoff, 28 October 2026. This document is dedicated evidence for parent integration; shared DECISIONS.md and VERIFICATION.md were not edited by this task.

## Workflow and authority

The active **Administrator** view can open **Edit machine** from each Asset registry card or the machine overview. All other active roles retain their existing organization/machine read scope and can view the current photo. Administrator does not gain engineering approval, restoration, reporting or calendar powers.

Machine name, manufacturer, model, department and location are editable. Optional blank fields save as null; unknown metadata stays unknown. Machine code is read-only. API schemas reject code, ID, organization, operational status, unexpected fields and missing explicit metadata fields. Machine IDs/codes, import references, machine access, production/readings and original work-order evidence are never rewritten by editing. Department/location names resolve within the organization; new names create scoped reference rows and previous reference rows remain intact.

The modal retains text, file selection and request keys on close/reopen on the same page. Saves disable controls and dismissal. Save errors remain in the modal. A conflict, revoked access, unavailable dependency or uncertain result blocks further mutation until **Refresh machine and discard draft** explicitly reloads the current record and discards unfinished entries. Successful changes refresh the registry card or overview and its photo. Metadata and photo saves are separate actions; photo success preserves unsaved metadata text. The latest machine version is retained after a confirmed receipt even if the subsequent read fails. A malformed save response produces a visible recovery error, rather than crashing a state updater.

Cards are semantic articles with scoped block/flex layout. Navigation, photo retry and edit actions are separate controls; no buttons are nested in a navigation link. Overview retains the truthful unavailable-live-status/telemetry state. Removed the pilot-specific WH-B/model explanation strip and replaced the outdated registry WH-C-only import claim with current standard-template wording. The yellow theme is preserved.

## Transactions, retries and history

Metadata, replacement and removal share the existing `Machine.version` with access administration. Each new operation locks the scoped machine row, rechecks active trusted Administrator membership/role, checks the expected version, changes only the requested registry presentation, increments version and appends an immutable AuditEvent in one transaction. Failure to append audit rolls back reference creation, metadata/photo changes and version together.

Under the same machine-row lock, matching action/request UUID receipts are checked **before any photo deletion/insertion or version change**, after live authority rechecks. The fingerprint includes actor, active role, expected version, normalized input and source-photo digest/metadata. Exact retries return the original version without a second write/audit. Changed reuse conflicts. Distinct competing intents permit one expected version. An old successful upload retry never restores an image that was subsequently replaced/removed. Request keys are action- and machine-scoped; the same key cannot silently change its input for that action.

`MACHINE_DETAILS_UPDATE` retains before/after metadata. `MACHINE_PHOTO_REPLACE` and `MACHINE_PHOTO_REMOVE` retain before/after normalized-photo metadata and original-source filename/MIME/size/digest/dimensions, uploader identity/name and receipt time. Audit events use the existing append-only protection. Photo receipt time is not capture/inspection time. No EXIF observation times, engineering judgments or authentic/synthetic labels are inferred. Original operational reports and their attachments/history are untouched.

## Raster validation and storage

One still JPEG, PNG or WebP, nonempty and at most **5 MiB**. Filename is at most 160 characters, with paths, controls and Unicode formatting characters rejected. Extension, strict supplied MIME and byte signature must agree; generic MIME, SVG/PDF, remote URLs and arbitrary active media are rejected. WebP additionally checks its RIFF length. Animated/multipage inputs are rejected.

`sharp@0.35.5` is a pinned direct backend dependency (it was already present transitively through Next). Its decoder checks the complete image with fail-on-warning, a 16,000,000 input-pixel limit, independent 8192-pixel side limits and a five-second processing timeout. Valid images are auto-oriented and re-encoded as still WebP, at most 2048 pixels per side, with metadata stripped and a second 5 MiB output bound. The original uploaded bytes are not retained. Decoding/re-encoding removes trailing payloads and metadata from the served raster; it is not proof of authenticity, antivirus scanning or a guarantee against future native decoder vulnerabilities.

The existing singleton `AttachmentUploadLimit` wraps multipart processing **and raster normalization**: at most four active uploads per API process and two per authenticated user. It is shared with work-order evidence uploads and releases capacity on success, error or cancellation. It is a process-local resource bound, not a distributed quota/rate limit.

`maintenance.MachinePhoto` retains only the **current** private display photo (one row per machine). Replacement/removal delete prior display bytes and retain audit metadata; they do not delete work-order evidence. Source-byte or replaced-photo recovery is intentionally not offered. Existing database backups may retain older content under the deployment's retention policy. Storage is bounded to 5 MiB current payload per machine, while organization growth and audit retention need operational capacity planning.

SQL enforces organization/machine association, uploader existence, payload count, SHA-256, bounded normalized dimensions and WebP signature. Runtime receives photo SELECT/INSERT/DELETE but no UPDATE, and only the five editable Machine columns in addition to existing version/timestamp permissions. Identity/code, membership/role grants and audit updates/deletes stay forbidden. Infrastructure credentials remain trusted; application authority is enforced by authenticated service transactions. No browser database grants, public buckets/assets, signed public URLs or filesystem upload store are introduced.

## REST contract

Existing registered `MachineRegistrationController` / `MachinesService` contain the new routes; **no app.ts registration changes are needed**. The already registered `AttachmentUploadLimit` provider is reused.

- `GET /api/machines/:code/details`: scoped machine metadata, current photo metadata (never bytes), `canManage`.
- `PUT /api/machines/:code/details`: Administrator only; UUID requestId, expected integer version, name and explicit nullable manufacturer/model/department/location.
- `POST /api/machines/:code/photo`: Administrator only; multipart `file`, requestId and version. One file/two fields/three parts, bounded 100-byte text fields.
- `POST /api/machines/:code/photo/remove`: Administrator only; requestId and version.
- `GET /api/machines/:code/photo/:id`: every currently scoped reader. IDs are additionally scoped to machine and organization. Replacement/removal invalidates the old ID. Every retrieval rechecks current membership, selected role and machine access.

Photo bytes use only `image/webp`, a fixed safe inline filename, `private, no-store`, explicit byte count, `nosniff` and sandbox/default-src-none CSP. Browser requests include bearer authentication and the trusted active-role selection; tokens never appear in URLs. Images use temporary blob URLs, released on revision, retry and unmount; pending reads abort when unmounted. Loading, missing-photo, retrieval retry and image-decode error states are explicit. A photo already delivered to a user's browser cannot be recalled by later revocation; later requests fail live checks.

400 invalid input/unsafe raster, 401 absent/expired identity, 403 unauthorized/revoked role, 404 unavailable machine/photo, 409 stale version/changed retry, 413 byte bound, 429 process upload capacity, 503 unavailable dependency. No protected mutation is automatically replayed.

## Parent integration and limitations

Migration: `prisma/migrations/202610280026_machine_details_photos/migration.sql`.
SHA-256: `a62a2bc42f82c3d3c8fc0967201014ea1f0ba6632fe13204f906980f0dc7c1a2`.
It has been applied only through the documented `db:test:prepare` workflow to isolated `maintenance_test`; no applied migration was edited. Hosted application/grants and operational records were not touched.

Parent must review/apply migration 026 and the appended narrow runtime grants through the hosted migration runbook, regenerate Prisma if required and regenerate OpenAPI/client contracts at freeze. The UI currently uses the documented local `MachineDetailsView` response alias in machine-details.tsx; parent can replace it with the generated MachineDetailsDto type after regeneration. No base MachineDto/repository response contract was changed by this task.

Registry currently fetches `/details` once per mounted card to discover lightweight current-photo metadata, then fetches bytes only for a present photo. This is an **N+1 metadata-read limitation** (default page 25; further loaded cards also mount). Metadata never includes blob bytes. Parent should consider adding nullable lightweight photo ID/dimensions to `machineSelect` / MachineDto and passing that summary to the photo component as a follow-up optimization for larger registries. This was left explicit rather than expanding the shared base registry contract during parallel work.

The pre-existing machine privilege assertion in `apps/api/src/tests/database.integration.ts` still expects even `Machine.name` updates by the restricted infrastructure login to fail. Parent must change that legacy assertion to immutable `code`/identity (the new scoped grants intentionally permit audited API metadata updates). The new machine suite independently checks runtime code/audit/photo UPDATE denial. No shared database.integration.ts or shared documentation was edited by this task.

## Changed files owned by this task

- apps/api/src/machines/controller.ts, dto.ts, service.ts; new photo.ts.
- apps/api/src/tests/machines.integration.ts; new machine-details.test.ts.
- apps/web/components/machine-registry.tsx, machine-workspace.tsx; new machine-details.tsx and machine-details.module.css.
- prisma/schema.prisma (Machine.photo relation and MachinePhoto model only).
- new migration 202610280026_machine_details_photos/migration.sql.
- infra/runtime-grants.sql (appended narrow metadata/photo grants).
- package.json and package-lock.json (pinned direct sharp dependency; existing shared edits preserved).
- new tests/browser/machine-details.spec.ts and this dedicated document.

## Verification evidence

Executed on 28 October 2026, exclusively with synthetic local fixtures and isolated *_test records:

- `npm run db:generate`: passed.
- `npm run db:test:prepare`: passed; migration 026 deployed only to maintenance_test, seed twice, restricted runtime grants applied.
- `npm run typecheck`: passed (API, web and browser-test TypeScript).
- `npm test`: **171 passed**, including raster type/signature/MIME/name/size checks, metadata stripping, resizing, decompression/side limits and animated WebP rejection; shared upload gate tests exercise process/user saturation and release on completion/failure/cancellation.
- Focused machine API integration: **19 passed** through real NestJS HTTP/auth guards and restricted PostgreSQL runtime, with test-only identity verifier. Includes Administrator-only edits/upload, current multi-role separation, all six scoped photo readers, anonymous/foreign/other-machine denial, stale versions, exact/changed racing retries, concurrent metadata/access CAS, rollback on all three audit failures, private headers/normalized raster, replacement/removal, source metadata retention, code/audit protection and immediate machine/membership revocation.
- Final desktop/mobile fixture browser run: `npx playwright test tests/browser/machine-details.spec.ts tests/browser/machines.spec.ts --workers=2`: **38 passed** after the scoped article/card fix. Covers draft retention, readonly code, save/refresh/error recovery, upload/file retention/display/removal, all five read-only role views, registry registration/access/search regressions, explicit actual-overview navigation, two missing-photo cards, standalone retry actions and no horizontal overflow.
- Cross-feature restricted-runtime integration: `node --env-file-if-exists=.env --test --test-concurrency=4 apps/api/dist/tests/machines.integration.js apps/api/dist/tests/machine-imports.integration.js apps/api/dist/tests/attachments.integration.js`: **36 passed** (19 machine, 8 machine-import and 9 attachment cases). No operational databases were used.
- Visually inspected final `.local/machine-editing/registry-missing-two-chromium.png`, `registry-missing-two-mobile.png` and `overview-chromium.png`: continuous filled cards/borders/shadows, two missing-photo states, separate navigation/edit controls and actual overview photo display are present. Final overview mobile screenshot is also retained privately beside these. Earlier in-flight screenshots showed an inline-link card regression; the article layout above corrects it. No company images are in these screenshots.
- T3 native preview was opened on the owned 3100 fixture server and its sign-in boundary inspected. The native tab has no intercepted test Auth provider, so authenticated mutations were exercised only in documented Playwright fixtures and isolated DB HTTP tests, not by injecting browser identity or using real operational credentials. Personal Chrome was not automated.

No commit, push, deployment, hosted migration/grants, credential change or company-photo upload was performed. The shared main localhost:3000/4000 processes were neither started nor stopped by this task. Generated OpenAPI/client regeneration and hosted acceptance remain parent integration work.

The isolated database reservation is released at this handoff; no further test preparation/suite is running for this task. Port 3100's Playwright-owned fixture server was stopped by Playwright after completion. The native preview tabs only remain as page history; main servers were left under parent ownership.

## Parent integration refinement

Added a nullable lightweight photo summary (ID/normalized dimensions only) to scoped registry and machine responses. Current cards/overviews use that summary and request authenticated bytes only for an existing photo; they do not make a metadata-discovery request for every card. Older responses remain compatible through a fallback metadata read. An explicit Retry photo refreshes metadata so an image replaced after the list was loaded can be recovered. Binary bytes/source filenames are never added to machine-list responses.

Regenerated OpenAPI with an explicit MachinePhotoSourceDto and replaced the temporary local MachineDetailsView shape with the generated MachineDetailsDto contract. Kept general photo requirements concise, with dimension/metadata-processing details under an expandable section. The original subtask's N+1 limitation and parent-contract TODO above are superseded by this refinement; final combined evidence belongs in VERIFICATION.md.
