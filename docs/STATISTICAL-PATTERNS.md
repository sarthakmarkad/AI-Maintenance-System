# Statistical pattern review — milestone 6

Open WH-C → Process trends. After the three charts, **Statistical patterns** explains sudden changes, sustained shifts and gradual drift in saved synthetic hourly readings. Matching endpoint dots appear on the charts; filters apply across all pages. This is retrospective analysis after import, not live monitoring, industrial limit detection or fault diagnosis. The earlier invented-band review remains a separate calculation.

## Versioned demonstration policy

Policy `synthetic-rolling-mad-v1` evaluates each parameter independently using only typed saved numeric values and measurement instants. It never reads workbook event labels, formula review flags, production losses or maintenance outcomes. All inputs are SYNTHETIC; unverified reported equipment ranges are not used.

Every rule needs a baseline of **24 consecutive earlier hourly observations**, immediately before that rule's evaluated sample window. Missing hours invalidate the entire baseline/sample window. There is no interpolation or comparison across a gap. The first sudden-change check needs 25 observations, a shift needs 27, and drift needs 30. Eligibility counts are observations, not parameter-value counts. With insufficient history, the UI reports that evaluation was unavailable rather than claiming normal operation.

Let median `m` and MAD `median(abs(value - m))` describe the baseline. The effective scale is `max(MAD / 0.6745, demo floor)`. Minimum scales are hot temperature 1 °C, cold temperature 0.5 °C and pressure 1 bar. They avoid hypersensitivity when a synthetic baseline is constant; they are implementation choices, not instrument resolution or engineering limits. The [NIST MAD reference](https://itl.nist.gov/div898/software/dataplot/refman2/auxillar/mad.htm) defines MAD and its approximately normal-consistent scaling. This implementation does not assume a calibrated normal process or convert scores into probabilities.

| Rule | Evaluated samples | Strict trigger |
|---|---|---|
| Sudden change | Current hour | Absolute change from the previous hour exceeds 4 effective scales. Previous hour belongs to the 24-hour baseline. |
| Sustained shift | Last 3 consecutive hours | All three values exceed baseline median + 3 scales, or all three lie below median − 3 scales. Displayed change is their mean minus baseline median. |
| Gradual drift | Last 6 consecutive hours | Absolute last-minus-first change exceeds 4 scales, at least 4 of 5 steps follow that direction, and least-squares slope has the same sign. Displayed slope uses hour-index spacing. |

Threshold equality does not flag. Comparisons use unrounded values; screen numbers are rounded for readability. The baseline excludes the entire evaluated window. Rules roll independently at every endpoint, so adjacent flags and different rule types can overlap. Counts are neither episodes nor confirmed incident counts. A long changed regime can become the rolling baseline; absence of flags cannot establish safe/normal operation. Job/material changes, mode changes, sensor condition, engineering limits and false-positive/negative rates remain unvalidated.

The date filter selects endpoint measurement dates in Asia/Kolkata, inclusive, at most 31 days. Analysis fetches up to 30 additional prior hours so an eligible endpoint gets the same evidence regardless of the visible date-window edge. Future readings never affect an earlier endpoint. The default is the latest measurement day and preceding 13 days, matching Process trends.

## Review responsibilities and evidence

All six roles can read scoped flags, source references and review history. Operators and technicians still need explicit machine access. Only **Maintenance head** can choose Needs investigation or Dismissed, with a required reason. Administrator and Supervisor cannot record this engineering decision. The same pilot identity's active role must be a current trusted grant; permissions never combine.

Each flag key hashes the policy version, parameter, kind, direction and ordered baseline/sample reading UUIDs. Readings are immutable through the runtime account. The key is independent of filtering and pagination. A review submission supplies key, endpoint time, decision and reason. The compatible combined review/open API can also take an explicit eligible technician; the UI saves the review first and releases an investigation separately. The server rechecks live scope/role and recalculates the evidence; browser-provided values, organization, actor, policy or arbitrary snapshots are rejected.

One final review per organization/machine/flag is retained. Same reviewer + same decision/reason/time retries return the original receipt (combined requests also match the immutable opening-assignment fingerprint); changed/concurrent decisions conflict. The UI blocks further actions after conflict until explicit reload. A transient service error retains the draft. Review receipts record actual head identity/role/time and preserve the complete 24-point baseline, evaluated samples, source/import references, individual receipt times, statistics and policy. Saved review history has independent pagination and includes evidence outside the current date window or future policy results.

Review insertion and ANOMALY_REVIEWED audit share one transaction. Audit failure rolls back the review. Unique scoped keys, scoped machine/reviewer foreign keys, narrow INSERT-only grants and an immutable UPDATE/DELETE trigger protect saved decisions/history. Database owners remain trusted administrators who can alter database protections; this is not an external tamper-proof ledger. Decision corrections/reopening are deferred rather than silently overwriting engineering history.

No breakdown, work order, RCA, maintenance schedule or notification is automatically created by statistical detection. Needs investigation retains a human decision. A separate explicit head action releases one assigned INVESTIGATION order from that saved review, including older history. All roles see its current link/status; the order shows the retained evidence. The technician records findings/outcome, the head approves or returns, and head/supervisor closes. Investigation closure does not complete recommended follow-up repairs. See WORK-ORDERS.md for the full flow and compatibility API.

## Python and API boundary

`services/statistics/worker.py` is a separate Python analysis worker using only the standard library. NestJS launches it locally with isolated Python (`python3 -I`) and bounded JSON over stdin/stdout. The worker has no database connection, network listener, Auth token or inherited database/provider credentials. NestJS owns authentication, scoped data selection, review persistence and REST endpoints. This is a local process boundary, not a deployed FastAPI microservice or remote inference service.

Install Python 3.9 or newer as `python3` on PATH alongside the existing Node/PostgreSQL prerequisites. Local verification used Python 3.9.6; CI configuration selects 3.12, but hosted CI has not been run. No pip packages or extra server startup command is needed. Retain `services/statistics/worker.py` alongside the application build; copying only `apps/api/dist` is insufficient. Deployment topology remains separate work.

Per API process, at most two worker processes run simultaneously. Additional calls return a retryable 503. Each has a 5-second timeout and is killed on timeout, bad output or excess output. Input is at most 774 hourly rows and 512 KB; output is capped at 16 MB and strictly schema-checked. Flags are calculated on demand, not stored as unattended durable alerts; human reviews and explicitly released investigations are persisted. There is no background anomaly polling/queue or external model provider.

| Route under `/api/machines/WH-C/readings/anomalies` | Behavior |
|---|---|
| GET `/` | Optional paired from/to; parameter, kind and PENDING/REVIEWED filters; 5 flags per page with evidence, stable-key after cursor, complete counts and all matching chart endpoints |
| POST `/reviews` | Head-only key/measuredAt/decision/reason; server recalculation, immutable receipt and atomic audit; optional explicit technician for compatible combined release |
| POST `/reviews/:id/investigation` | Head-only explicit assigned investigation from retained INVESTIGATE evidence; duplicate-safe, no worker recalculation needed |
| GET `/reviews` | All scoped roles; newest-first history with 25 items and UUID after cursor, current investigation link/status and trusted head release capability |

Unavailable worker analysis leaves the existing charts usable and offers retry. No empty-success/healthy fallback masks worker failure. Neither HTTP nor Python exposes an authentication bypass. Existing reading import and breakdown/planned-work behavior remains unchanged.

## Executed verification

Unit tests run the actual Python worker for deterministic constant baselines, strict thresholds, both directions, robust MAD, sample exclusion, shifts, drift, missing-hour resets, causal/window invariance, invalid input and process concurrency. Real isolated PostgreSQL HTTP tests cover scope/all roles, selected-role enforcement, complete flag/history paging, filters, concurrent/retried reviews, forged evidence/time, SQL immutability, revoked grants and audit rollback. Desktop/mobile fixtures cover evidence/chart markers, head/read-only controls, retained drafts, decisions/history, conflicts, filters/paging, worker outage recovery, insufficient data and expiry.

The actual 336 imported observations were read through the restricted operational service under trusted local administration. Independent JavaScript calculations against the pre-change saved values matched all 59 flag keys and statistics (16 sudden changes, 29 shifts, 14 drift flags; 32 unique endpoint observations). These numbers describe this synthetic policy, not detection accuracy or real machine faults. No operational review or incident was fabricated. Existing production/readings/work orders/events/roles/calendar records match the pre-change checkpoint, and original workbook SHA-256 hashes are unchanged. Detailed values stay in ignored `.local` evidence.

The built-in browser redirected to login. No new credential entry or authenticated live browser acceptance is claimed. Browser screenshots/tests use fixtures; real database HTTP tests use test-only identity injection in the isolated `_test` database. See VERIFICATION.md for current totals/build evidence and hosted acceptance limits.
