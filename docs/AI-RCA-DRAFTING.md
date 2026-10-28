# AI-assisted RCA drafting — WH-C pilot

Optional advisory assistance for **BREAKDOWN**, assigned technician, active trusted **Technician** view, **IN_PROGRESS** only. Normal technician editing/submission and maintenance-head approve/return remain unchanged. Administrator cannot generate as an engineer or approve. No automatic generation, workflow mutation, event, restoration, approval or external messaging is added.

## Text-only evidence boundary

The server snapshots the original report (including original priority/impact and observation/report times), complete history metadata plus retained human submission/review/reassignment text, and four strictly validated current human fields. Current form fields are explicitly unsubmitted/unverified human statements. Input rejects additional sources, context, roles, organization, timestamps and restoration fields. Fields are empty or 3–4,000 trimmed characters. All four may be empty. Evidence is limited to 100 history events, 100 source entries and 48,000 UTF-8 JSON bytes; exceeding a bound rejects before the paid call, without silent truncation.

No attachment content, image interpretation, OCR, statistical readings, production data or SOP retrieval is performed. This pilot cannot claim a current manual/SOP or establish authentic causes from synthetic material. All causes remain unconfirmed. The original exact-model unknown status is preserved.

Facts are selected server-owned source IDs and expanded into exact attributed human text, never model-authored facts. Hypotheses, missing checks and corrective/preventive proposals require known source IDs. Unknown/duplicate references, unsupported numeric values, dates/times and explicit unsupported confirmation/restoration/SOP/image claims are rejected. Incomplete evidence yields LIMITED_EVIDENCE or INSUFFICIENT_EVIDENCE, never a confirmed-cause status. Insufficient output must have no hypotheses. Generated proposals and human-source excerpts can still be wrong; these bounded checks are not a semantic proof or complete prompt-injection defense. Technicians must review actual findings/actions before normal submission.

## Persistence, billing and concurrency

`RcaDraftRequest` is an immutable private reservation containing trusted scope/requester, normalized payload fingerprint, exact evidence snapshot/hash, source work-order version, selected model/policy and request UUID. Reservation + audit commit **before** one paid call. The provider runs outside database transactions. Successful generation rechecks current trusted role/grant/machine access, assignment, kind/stage/version and exact evidence fingerprint after acquiring the work-order row lock. Immutable `RcaDraftReceipt` + audit commit atomically. Work-order state, human fields, history and version are never modified by this feature.

A matching request UUID/payload returns the original retained receipt without another paid call. Changed payload conflicts. A pending/uncertain reservation never repeats a paid call, including after a process crash or audit failure. Failure/stale attempts retain a terminal safe marker where the database audit permits; failed audit rolls back its receipt. If even the failure audit fails, the immutable reservation remains uncertain and no generated content is delivered. Request receipt retrieval still requires current assigned-Technician/in-progress authority; all scoped readers can read retained history separately. Historic generated receipts carry an explicit stale flag when the work-order version changed.

One pending request per organization/user across API processes is admitted for a 75-second window using a short transaction advisory lock; no takeover/retry of the same request is possible. At most two provider calls run per API process; ten reserved attempts per user per ten minutes are allowed. Expired uncertain requests permit a **new explicit request UUID**, not a retry under the old UUID. These are bounded pilot quotas rather than a distributed global billing controller. No automatic paid retries or fallback model is used.

The isolated injectable `RCA_AI` adapter reuses backend Config and `settings`/`readAiJson` helpers. CommandCode only, fixed endpoint `https://api.commandcode.ai/provider/v1/chat/completions`, selected reviewed DeepSeek/legacy GLM model, `x-cmd-zdr:1`, strict schema in both format and system text, no tools, redirect rejection, 45-second timeout, 4,096-token maximum, temperature zero and DeepSeek low reasoning. Provider bodies/secrets are never logged. Incomplete/refused/malformed/oversize output fails closed. `RCA_AI_ENABLED=false` disables new generation; otherwise it defaults enabled for a configured CommandCode answer provider independently of document indexing. Other configured answer providers currently leave RCA unavailable. Manual completion stays available.

## REST and application registration

The existing root module registers:

```ts
import { RcaController } from './rca/controller';
import { RcaService } from './rca/service';
import { RCA_AI, RcaAiProvider } from './rca/provider';
// controllers: [..., RcaController]
// providers: [..., RcaService, { provide: RCA_AI, useClass: RcaAiProvider }]
```

Existing Database, WorkOrdersService, CONFIG, AuthGuard/RolesGuard and trusted Repository/identity verifier remain in use. No replacement auth provider or runtime identity fixture is introduced. Config must include `RCA_AI_ENABLED: z.enum(['true','false']).optional()` (parent has added it).

- `POST /api/machines/WH-C/work-orders/:id/rca-drafts` → `RcaReceiptDto`, HTTP 200; Technician guard. Body `{ requestId, version, human: { findings, rootCause, correctiveAction, preventiveAction } }`.
- `GET .../rca-drafts?before=<request-row-uuid>` → `RcaHistoryDto`; all six scoped roles, latest 20 with keyset pagination. No generation occurs on history reads.

OpenAPI/API client contracts are regenerated at version 0.14.0. Frontend response types use those generated DTOs. DTO classes are in `rca/dto.ts`.

Migration `prisma/migrations/202610270022_ai_rca_drafts/migration.sql` and narrow grants were rehearsed in `_test` and applied to hosted Supabase. The restricted runtime login receives:

```sql
GRANT SELECT, INSERT ON maintenance."RcaDraftRequest", maintenance."RcaDraftReceipt" TO <trusted_runtime_role_identifier>;
GRANT EXECUTE ON FUNCTION maintenance.rca_draft_immutable(), maintenance.rca_request_eligible(),
  maintenance.check_rca_request_audit(), maintenance.check_rca_receipt_audit()
  TO <trusted_runtime_role_identifier>;
```

Do not grant UPDATE/DELETE, identity writes, browser roles, Data API exposure, public assets or provider secrets. Existing work-order SELECT/column-update permission supports the short `FOR UPDATE` row lock. This migration adds composite scope FKs, immutable/eligibility triggers, deferred matching protected-audit invariants, bounded JSON/check constraints and history/quota indexes. It makes no operational data/role changes.

Prisma models mirror the exact migrated tables and scoped foreign keys. Conceptual shape (the actual schema also retains exact index/constraint mappings):

```prisma
model RcaDraftRequest {
  id String @id @db.Uuid
  orgId String @db.Uuid
  machineId String @db.Uuid
  orderId String @db.Uuid
  userId String @db.Uuid
  requestId String @db.Uuid
  fingerprint String @db.VarChar(64)
  version Int
  sourceHash String @db.VarChar(64)
  model String @db.VarChar(100)
  policy String @db.VarChar(64)
  snapshot Json
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  order WorkOrder @relation(fields: [orgId,machineId,orderId], references: [orgId,machineId,id], onDelete: Restrict)
  requester Membership @relation(fields: [orgId,userId], references: [orgId,userId], onDelete: Restrict)
  receipt RcaDraftReceipt?
  @@unique([orgId,userId,requestId])
  @@index([orgId,machineId,orderId,createdAt(sort: Desc),id(sort: Desc)], map: "RcaDraftRequest_history")
  @@index([orgId,userId,createdAt(sort: Desc)], map: "RcaDraftRequest_quota")
  @@schema("maintenance")
}
model RcaDraftReceipt {
  requestId String @id @db.Uuid
  status String @db.VarChar(16)
  reason String? @db.VarChar(64)
  draft Json?
  completedAt DateTime @default(now()) @db.Timestamptz(3)
  request RcaDraftRequest @relation(fields: [requestId], references: [id], onDelete: Restrict)
  @@schema("maintenance")
}
// Add rcaDraftRequests RcaDraftRequest[] to WorkOrder and Membership.
```

## Completion-form integration

`apps/web/components/rca-drafting.tsx` exports `RcaDrafting`, `RcaDraftHistory`, `RcaHumanFields`, `RcaProvenance`, `RcaDraftReceipt`. It is mounted only inside the existing authorized BREAKDOWN technician completion form, below current inspection fields:

```tsx
<RcaDrafting
  key={order.id}
  code={machine.code} orderId={order.id} version={order.version} token={token}
  human={{ findings, rootCause, correctiveAction, preventiveAction }}
  disabled={busy || conflict}
  onFailure={failure}
  onApply={(patch, provenance) => {
    // Apply only provided text fields into the current completion-form state.
    // Preserve every other field, including restoredAt.
    setForm(current => ({ ...current, ...patch }));
    // provenance identifies suggestions applied locally, not a claim of exact final submission.
  }}
/>
```

Callback signature is `(patch: Partial<RcaHumanFields>, provenance: { draftId, sourceHash, version, fields }) => void`. If the parent keeps individual state setters instead, map only present patch properties. Never forward provenance as unknown fields to the unchanged submit schema. Drafts remain linked to the order in their own immutable history even if discarded. Exact submitted-text attribution is deliberately **not claimed**; normal immutable SUBMIT history is the human report.

Individual Use buttons or Apply reviewed draft copy only explicitly chosen reviewed fields. The panel itself has editable suggestion text; the parent completion form remains editable afterwards. Generation never populates any form field. A field changed in the parent since the request began cannot be overwritten by Apply; a stale work-order version disables all Apply controls. Every action button is `type="button"` so generating/applying inside a completion form cannot submit it. No restoration field exists in the component, input or output. Pending errors keep manual work intact. Keys/abort and scope checks discard responses after switching order/token.

Mount read-only history outside the action form for scoped BREAKDOWN readers:

```tsx
<RcaDraftHistory code={machine.code} orderId={order.id}
  version={order.version} token={token} onFailure={failure} />
```

History labels generation as advisory source evidence and explicitly says technicians may edit/discard it. Head approval still reviews the submitted human fields through existing approve/return; AI generation requires no separate head approval.

## Verification

Feature-specific deterministic results are recorded below as execution finishes. Combined verification and live-provider evidence follow; full details are in VERIFICATION.md. No operational acceptance write or real notification was created.

Implementation-agent execution, 27 October 2026:

- API/web/browser TypeScript checks passed during feature development.
- `npx tsc -p apps/api/tsconfig.json && node --test apps/api/dist/tests/rca*.test.js`: **22/22 passed** (policy, exact evidence/limits/attribution, HTTP-provider doubles, service transaction fixtures, exact retries/pending overlap, provider failure, live trusted role/machine/assignment/version rechecks, audit rollback and uncertain paid-attempt behavior).
- Final complete mounted fixture pass: **20/20** desktop/mobile cases passed, including explicit Apply/edit/normal submit, no restoredAt autofill, pending newer edits, provider error/manual fallback, stable original request retrieval, lazy head history, planned exclusion, busy-409 manual preservation and access-denial clearing. The final pass also covers stale-version Apply blocking, delayed-failure edit/restoration preservation, investigation exclusion and visible original generated text in retained head history. Both viewport cases assert no page horizontal overflow with the review panel open.
- Parent reported isolated migration/grant rehearsal and the first full DB run: 168/169 passed; the sole failure was the RCA test expecting 500 for an injected known DB failure, where the repository correctly maps it to 503. Both test expectations were corrected without changing strict rollback/provider-count assertions or SQL. The implementation agent did not run DB suites; parent owns the final DB evidence.
- Early browser attempts failed due to fixture harness configuration/hydration, strict label selectors after controlled updates and Playwright datetime formatting. Final harness uses a standard Next CLI source copy under ignored `.local/rca-web`, port **3122**, isolated cache and fixture-only Auth/API routing. It copies only app/components/lib/PostCSS/package code, never environment/company files. The final mounted tests use accessible textbox roles and native minute-precision date entry with the existing explicit IST→UTC conversion.

Optional one-call real-provider fixture, **parent coordination only**, not run by the implementation agent:

```sh
npm run build:api
RCA_LIVE_FIXTURE=1 node --env-file-if-exists=.env apps/api/dist/tests/rca-live-fixture.js
```

This sends one synthetic text snapshot, never connects to a DB, never retries and writes only safe result metadata to ignored `.local/rca-live-fixture.json`. Provider/output variability remains a limit until parent acceptance succeeds. The production service still performs real trusted membership and persisted-evidence checks; this standalone synthetic provider probe is not a runtime identity path.

Focused browser command (independent from the root runner/external-notification agent):

```sh
npx playwright test --config tests/browser/rca.playwright.config.ts
```

Parent shared callbacks should forward only authentication expiry (401) to global failure handling. Keep RCA busy/quota/pending 409s and provider errors local, so they never disable manual completion as a purported work-order CAS conflict. Real normal submit retains its unchanged version enforcement.

## Final combined acceptance — 27 October 2026

All 142 unit/script tests, 169 PostgreSQL integration cases and 344 desktop/mobile browser cases passed, plus strict TypeScript, Prisma validation, regenerated contracts, production build and dependency audit (zero vulnerabilities). The eight real RCA database cases cover trusted roles/scope, exact retries/concurrent reservations, version/evidence changes, revoked grants, immutable SQL/audit guards and rollback before delivery. A root integration fix gives retained history a distinct React key from attachments; attachment failure/retry/preview cases and all six-role switching passed again. History tests assert lazy/read-only behavior rather than the number of aborted GETs under development StrictMode.

The opt-in potentially billed `npm run test:rca:live` exercises the actual configured DeepSeek provider in matching `_test` owner/runtime databases. The final executed equivalent script passed three cases: persisted immutable generation with unchanged work order, exact retry with no new paid call, subsequent technician-authored submission and separate head approval/closure; sparse-observation insufficient evidence; embedded-instruction refusal. All three provider attempts returned the selected DeepSeek model with stop completion and 7,745 total reported tokens. No operational incident or draft was written. The retained private report is `.local/feature-work-20261027/rca-live.json`; future runner output is `.local/rca-live.json`. These finite passes do not guarantee accuracy or defeat all prompt injection.

On hosted persistence, all six actual pilot role views read the empty retained-history endpoint; Administrator has no generation/engineering authority. Authenticated operational browser actions were not fabricated: the native browser profile redirects to login, so UI verification used intercepted fixtures. The existing work-order evidence/role records match pre-change content digests. Draft generation remains an explicit potentially billed action, not a background job.
