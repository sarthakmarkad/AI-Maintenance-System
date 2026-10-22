# Synthetic process readings — milestone 3

The WH-C Process trends page imports the supplied hourly workbook through preview, review and atomic commit. It is a retrospective software demonstration. Original workbook bytes are processed in memory and discarded; parsed source cells and provenance remain in private PostgreSQL. Production records remain separate.

## Source contract

- Exact Guide and Hourly_Readings sheets; headers identify reading ID, machine, local time, demo shift, hot/cold temperature, pressure, synthetic provenance and three original formula flags.
- Guide must identify WH-C, SYNTHETIC, Asia/Kolkata and the supplied invented bands (hot 180–220, cold 40–50, pressure 80–120). Temperature units are assumed °C; pressure is labelled bar. No sensor location, engineering safe limit or normal operating band is established.
- A small namespace-aware saxes reader handles both default and prefixed OOXML namespaces. It rejects DTD/custom entities and does not evaluate formulas, links or macros. It shares the production archive guard: compressed 8 MB, expanded 64 MB, 3,000 members, unsafe/duplicate/encrypted/external-link/macro entries blocked. Parsed XML limits depth, element count, rows, columns and cell length.
- Maximum 1,000 observations over 31 days; source rows 2–1,100, columns A–K. Blank rows are skipped. Unknown layouts, changed guide assumptions or damaged workbooks fail as a whole.
- Each observation needs a valid source ID, WH-C, SYNTHETIC, a real whole-hour local timestamp, the corresponding invented demo shift and three finite numeric values with at most three decimals. Generic magnitude bounds protect storage; they are not industrial limits. Booleans, error cells, ambiguous strings and absent formula caches are rejected. Cached numeric measurement formulas are accepted without recalculation and preserved as source cells.
- Numeric Excel serials honor the 1900/1904 date system. Strict local ISO text is also supported. Wall-clock time is explicitly interpreted in Asia/Kolkata, then stored as UTC timestamptz. Actual shifts are not inferred: only this workbook's invented A 00–08, B 08–16 and C 16–24 assumption is checked.
- Invalid rows and every in-file duplicate ID/time are excluded visibly. No date/value is guessed or corrected. Existing ID OR timestamp conflicts are excluded, including renamed workbooks. The import commits all eligible new rows after acknowledgement; individual row editing and corrections are deferred.

## Persistence, authorization and concurrency

ReadingImport retains SHA-256, filename, sheet, parser/review policy versions, immutable staged source JSON, trusted creator, preview expiry and commit time. ProcessReading retains typed decimal parameters, source ID/row, original local timestamp, UTC measuredAt, receivedAt, demo shift and raw cells. Formula review cells are provenance only.

Scoped composite foreign keys prevent cross-organization/machine/source references. PostgreSQL checks enforce SYNTHETIC source, whole local hours and consistency between UTC and retained local timestamps. Unique machine/source/timestamp and machine/source/ID constraints prevent duplicate observations. Saved values cannot be updated or deleted by the runtime role. Only import status/timestamp may be updated; identity and machine records remain read-only.

Operators/technicians read granted machines; other roles read within their organization. Import and full source-preview access use the documented production-import assumption: administrator, maintenance head or supervisor only. Service and controller enforce the import role; every request still uses verified Supabase identity and a fresh trusted membership. Administrator does not gain engineering review authority.

Commit locks the scoped preview, checks 24-hour expiry and overlap, then atomically inserts readings, marks the import and appends audit. Audit failure rolls back everything. Identical preview retries return their original count without another commit audit. Cross-preview races return conflict, with no partial import. After conflict/expiry, create and review a new preview; a refresh cannot silently change an acknowledged selection. There is no overwrite/revision endpoint.

The trusted local demo CLI is an alternative administrative entry point, with the same parser/service/database checks and explicit commit/acknowledgement flags. It resolves the supplied verified UUID to active stored membership and marks preview/commit audit detail LOCAL_CLI. It neither authenticates a Supabase session nor creates an HTTP authentication alternative. Local shell/database access remains trusted administration.

## Trends and review semantics

GET trends accepts an inclusive local date window of at most 31 days. The default is the latest measurement day and preceding 13 days, or the equivalent current local window before any import. Points include every scheduled hour, with null values for missing observations. Charts use straight segments only between adjacent observations, preserve isolated points and never bridge null gaps. Separate charts preserve each parameter's units. Statistics are min, mean and max of saved observations in the window; means are rounded to three decimals.

Latest measurement and last receipt are dataset-wide timestamps labelled separately. Import history is limited to 20 batches contributing to the selected window. Source rows are paged in the UI; authorized importers can review full retained source snapshots. Nothing on this page claims a live connection.

Versioned policy demo-hourly-bands-v1 flags strict values below/above the invented bounds; endpoints are inclusive. It computes reviews from saved parameters at query time, after receipt. Workbook I–K flags and Demo_Events are never inputs. Adjacent out-of-band hourly observations in the same direction form a group; missing/in-band samples or a direction change end it. Window edges can split a group. One observation is labelled isolated; two or more are consecutive observations. First/last measurement times and latest constituent receipt time are retained in the response. They are not continuous event duration or an independently persisted alert creation time.

Unique review samples count observations crossing any band; per-parameter counts can overlap. Review periods count groups per parameter. No notification, emergency alarm, automatic breakdown, approved RCA or ML model is created. Event labels cannot establish a cause for authentic production losses, and between-sample events may be absent entirely. Future policy changes need explicit version/migration semantics before altering historical interpretation.

## REST contract and limits

- POST `/api/machines/WH-C/readings/previews`: multipart file only.
- GET `/api/machines/WH-C/readings/previews/:id`: scoped retained preview.
- POST `/api/machines/WH-C/readings/previews/:id/commit`: `{ "acknowledgeWarnings": true }`; extra/edited quantities or scope fields are rejected.
- GET `/api/machines/WH-C/readings/trends?from=2026-09-01&to=2026-09-14`.

The reading parser permits one processor per user and two per API process for this route. Multipart counts are bounded; JSON retains the existing 64 KB limit. Shared distributed quotas, original-byte private Storage, async queues and industrial anomaly services remain future work. Supabase handles Auth; operational persistence is still local PostgreSQL.

## Verification

Unit tests cover namespace prefixes, IST conversion, raw provenance, invalid/duplicate rows, changed guide bands, missing formula caches, label exclusion, inclusive bounds and gap-separated reviews. Real PostgreSQL tests cover role/org/machine scope, staged immutability, same/different-preview concurrency, renamed files, atomic audit rollback, expiry and protected saved readings. Desktop/mobile fixture tests cover acknowledgement, commit/reload, source distinction, conflicts and expiry.

The supplied original was independently checked against raw worksheet XML: 336 observations, 1,008 parameter values, no missing scheduled hours, 3 hot / 5 cold / 5 pressure review values and four review groups. Original workbook checksums remain unchanged. Detailed private source and operational checks stay in ignored `.local`. See VERIFICATION.md for the executed checks and the distinction between fixture browser tests, trusted CLI import and actual hosted-auth browser acceptance.

## Statistical extension (M6)

The separate Python worker now evaluates sudden changes, sustained shifts and gradual drift against earlier saved synthetic values. It preserves causal windows and gaps, supplies evidence and chart markers, and supports head-only retained review decisions. The original invented-band review above remains unchanged and separately labelled. No authentic production values, workbook labels, automatic breakdowns or industrial fault claims enter this analysis. See STATISTICAL-PATTERNS.md for the versioned policy, Python setup, roles and verification limits.
