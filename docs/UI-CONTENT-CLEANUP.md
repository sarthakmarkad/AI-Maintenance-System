# Operational UI copy cleanup — 28 October 2026

## Scope and boundaries

Task 1 changes user-visible frontend copy and presentation of existing source metadata. It does not change production functionality, API requests, authentication, trusted display names, role grants, assignment/review actions, stored records, parameters, templates, calculations or styles. The yellow theme remains. No credentials were read or changed, no operational records were created, and no main server on ports 3000/4000 was started or stopped. No commit, push or deployment was performed.

The shared checkout already contained extensive authorized work. Task edits were compared against local pre-task copies of the owned frontend files, rather than treating the full Git diff as this task's work. `docs/VERIFICATION.md`, `docs/DECISIONS.md`, `Maintenance_Handoff/`, shared styling and the excluded frontend files were not edited by this task.

## Changes and rationale

- `apps/web/app/login/page.tsx`: replaced frontend key/setup instructions with a clear sign-in configuration state and administrator contact action. Disabled Google sign-in now says it is unavailable instead of implying setup is underway. Availability checks, disabled states and email fallback remain unchanged.
- `apps/web/components/work-orders-workspace.tsx`: removed repeated page marketing introductions and one repeated observation instruction; replaced “assigned pilot users” with role/assignment guidance that does not presume a Technician grant. Reporting, assignment controls, required human evidence, independent restoration/review/closure times and history remain intact.
- `apps/web/components/calendar-workspace.tsx`: removed the repeated page introduction and “no invented company schedule” implementation commentary from the empty state. Kept the head's next action, fixed IST dates, generation coverage, explicit release/review/closure and partial-schedule notices. Empty-task and technician eligibility copy now refers to the selected machine rather than WH-C. Reminder empty-state copy describes when reminders appear.
- `apps/web/components/production-workspace.tsx`: removed a repeated introduction and the unnecessary statement that templates have no sample output. Shortened import descriptions while preserving declared authentic versus SYNTHETIC source, original workbook retention limits, kg/template mappings, separate daily controls, excluded dates and explicit review/import. Hash/parser identifiers are retained under an expandable **Source details** section; filename, worksheet and source remain directly visible.
- `apps/web/components/readings-workspace.tsx`: removed a repeated introduction and changed “discards workbook bytes” into a concrete records-retention instruction. Hash/parser identifiers remain available under **Source details**. Synthetic banners, invented bands/units/shifts, missing history/gaps, measurement versus receipt times, retrospective limits and formula/event-label exclusions remain unchanged.
- `apps/web/components/document-library.tsx`: replaced “real manual / no references preloaded” scaffolding with the draft/review action. Replaced “supersede atomically” with its user-visible effect: replace the current reference and retain history. Head-only approval, administrator limits, withdrawal behavior, hashes and immutable source history remain.
- `apps/web/components/anomalies-workspace.tsx`: removed a repeated investigation opening/confirmation explanation from the popup body; its popup description still explicitly says opening an investigation does not confirm a breakdown. Technician-role instructions and explicit separate review/assignment remain. Policy explanations, NIST citation, causal prior-only coverage and retained evidence were not removed.
- `apps/web/components/performance-workspace.tsx`: corrected the introduction to name available workload, planned closure and investigation outcome measures instead of removed workflow delays. Reworded the missing scheduler run state without hiding the service-restart coverage limit.
- `apps/web/components/reports-workspace.tsx`: removed a redundant active-role/access explanation, retaining the meaningful warning that downloading records does not approve work.
- `apps/web/components/external-notifications.tsx`: uses the selected machine code in the header instead of hardcoded WH-C. Reworded delivery-key/worker jargon into processing, acceptance uncertainty and scheduled retry states. Confirmed-email requirements, terminal failures, cutoff/sending races and provider-acceptance versus inbox-delivery distinction remain.
- `apps/web/components/rca-drafting.tsx`: made the review instruction direct while retaining the limits on confirming causes, restoration, submission and approval. Shared retained input disclosure, manual completion, source provenance, missing evidence and human review remain.

Reviewed without changes: document assistant, chat rendering/errors, attachments/photo viewer, work-order notifications, page finder, auth callback/recovery, error/not-found pages, route wrappers, shared controls and shell. Their remaining descriptions explain supported actions, real errors, confidentiality/provider disclosure, source citations or consequential limits. Real empty states and input example placeholders are retained; they are useful controls rather than fake records.

## Excluded-file review for parent integration

- `apps/web/components/machine-workspace.tsx`: the earlier WH-C-only “newer ... pilot line / WH-B” explanation should be removed or replaced with the actual model/monitoring gaps; the parent reports this is already assigned to the machine agent. Preserve null model/location/manufacturer states and distinguish registry status from live health.
- `apps/web/components/machine-registry.tsx`: the earlier WH-C-only registration explanation should be removed by its owner; parent coordination confirms this assignment. Retain the selected-machine access instructions and actionable uppercase/unique-code rules. Current “Registry record” card wording avoids implying live telemetry.
- `apps/web/components/machine-access.tsx`: optional shorter popup description: “Grant machine access to existing Operators and Technicians. Accounts and roles are managed separately.” Keep the role-scope explanation and revocation/unfinished-assignment warning.
- `apps/web/app/layout.tsx`: metadata description still says “WH-C machine maintenance and performance intelligence workspace.” Suggested organization-wide replacement: “Machine records, maintenance work and approved team references.” No metadata edit was made here.
- `apps/web/app/page.tsx`: public overview prose can be tightened by its owner, but retain explicit human decisions and any conceptual illustration labels. No evidence justifies live telemetry, production-readiness, verified fault-cause or predictive-accuracy claims. No copy hardcoding of stored user names such as “Pilot administrator” is appropriate.
- `globals.css`, `design-system.css`, `refinements.css`: reviewed as shared styling boundaries; no task change or content suggestion needed.

## Verification and limits

Browser tests follow the documented `tests/browser/helpers.ts` Auth/API interception workflow. They use only synthetic in-memory responses, with GET-only assertions in the new empty-state fixtures. No database or provider sends are involved. A temporary copied frontend under ignored `.local/ui-content-web/`, separate Next cache, config and port **3122** keep ports 3000/4000 and reserved machine-agent port 3100 untouched. The temporary app has no copied private environment files. Its config explicitly allows its loopback dev origin.

Changed browser tests:

- `tests/browser/ui-content.spec.ts` (new): Administrator/Maintenance head/Operator reference and calendar empty states, management/head controls, missing-technician guidance, and a non-WH-C email page that retains delivery uncertainty.
- `tests/browser/team-auth.spec.ts`: expected disabled Google label only.
- `tests/browser/production.spec.ts`, `tests/browser/readings.spec.ts`: expandable source metadata remains readable before acknowledgement/import.
- `tests/browser/work-orders.spec.ts`: Administrator's no-action guidance and absence of engineering controls.

Executed results:

- The targeted desktop/mobile run passed **30/30** checks in 1.8 minutes. It covered the new copy/role fixtures, disabled/unavailable Google sign-in with working email fallback, production and readings preview/acknowledgement/import/source details, report downloads, available performance measures, manual RCA after provider failure, assignment and Administrator/Supervisor action limits.
- A final focused run passed **6/6** checks in 17.8 seconds: document revision/approval/withdrawal, explicit investigation assignment/retry and the final Administrator no-action text, each on desktop and mobile. The Administrator workflow scenario overlaps the preceding run; these are test executions, not 36 distinct scenarios.
- `npx tsc -p apps/web/tsconfig.json --noEmit && npx tsc -p tsconfig.tests.json` passed after the initial copy edits. A later repeat encountered TS6053 for `.next-test/dev/types/cache-life.d.ts` and `validator.ts` while the shared cache was being replaced. The current frontend source then passed `npx tsc -p .local/ui-content-tsconfig.json --noEmit` (same compiler settings, explicit current source includes, generated build caches excluded), and `npx tsc -p tsconfig.tests.json` passed again.
- `git diff --check` passed for the owned frontend files, related browser tests and this document.
- Initial temporary-server attempts failed before hydration because its loopback HMR origin was blocked. Adding `allowedDevOrigins: ["127.0.0.1"]` only to the ignored temporary server fixed that prerequisite. The next run had 14 passes and two five-second cold-start sign-in timeouts; the final temporary config allows 15 seconds for expectations, and all selected checks then passed. No application sign-in behavior was altered to address test setup.

Reproduction uses the ignored `.local/ui-content.playwright.config.ts` on port 3122. The two passing command selections were:

```sh
npx playwright test --config .local/ui-content.playwright.config.ts ui-content.spec.ts team-auth.spec.ts production.spec.ts readings.spec.ts work-orders.spec.ts reports.spec.ts performance.spec.ts rca.spec.ts --grep 'reference empty|calendar empty|email handoffs identify|disabled or unavailable|synthetic workbook preview|reading review excludes|head selects an eligible|supervisor closes approved|report preview downloads|performance separates|provider errors preserve'
npx playwright test --config .local/ui-content.playwright.config.ts work-orders.spec.ts anomalies.spec.ts documents.spec.ts --grep 'supervisor closes approved|saved investigation review opens explicitly|head uploads revision'
```

Logs are local only: `.local/ui-content-browser.log` and `.local/ui-content-final-browser.log`. These are frontend fixture checks, not live authenticated operational acceptance or independent staff-identity verification. The isolated app is a source snapshot, so concurrent machine-agent changes after copying are outside these browser results. No database tests or full production build were needed for copy/presentation-only edits.

T3 native preview opened the existing main app and inspected the signed-out login page. No credentials were entered and no operational actions were performed. The configured provider status was visible and no page/hydration error was reported in that snapshot. Authenticated operational pages were verified through fixtures rather than asserting live acceptance.

## Parent integration additions

The parent updated the shared page metadata to describe the organization-wide platform and shortened the access popup description without changing grants. On the overview, replaced the static workflow tutorial/marketing panel and always-present empty-record presentation with practical links under Machine records, including Work orders. Existing unknown profile fields and live-telemetry status remain truthful. Machine-photo technical processing details are available through an expandable requirements section; common format/size/replacement guidance remains directly visible.
