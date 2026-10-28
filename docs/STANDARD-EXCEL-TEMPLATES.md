# Standard Excel templates

Every registered machine has **Production** and **Process trends**, both in the sidebar and as links on its overview. New machines start with empty datasets. Choose the machine first; every import and chart stays in that machine's organization/access scope. WH-B remains reference-only.

## Production

1. Open the machine → **Production → Import workbook**.
2. Choose **Template month**, then **Download Excel template**. This downloads an empty workbook for that machine/month.
3. Fill the monthly sheet, keeping the machine heading, marker and headers. Start data at row 8. Keep job rows for the same day together and put its date only on the first row.
4. Upload the workbook, read worksheets, select its month and preview. Declare the actual source: user-declared authentic production or synthetic demonstration. Review exclusions, original source cells and control totals.
5. Acknowledge and import only valid days. Committed totals/charts reflect saved records; retries do not duplicate data. Existing values are not overwritten.

| Column | Meaning |
|---|---|
| A | Real date in YYYY-MM-DD or an Excel date, first row of the contiguous day |
| B | Shift label A/B/C; no actual shift hours are inferred |
| C | Original job/reference; blank for an activity without production |
| D | That job's production in kg, including explicit zero when appropriate |
| E | Whole-number job-change count, when present |
| F | Scrap kg for this job/activity row |
| G | Independent daily production control kg, entered once per day |
| H | Independent daily scrap control kg, entered once per day |
| I | Original remarks |

For example, two job rows with D values 100 and 50 reconcile to one G control of 150; those controls do not add another 150 kg. F values 2 and 1 reconcile to H=3. These numbers explain the format only and are **not included in downloaded templates or operational data**. If a daily control is zero, enter zero explicitly. Missing/conflicting/mismatched controls exclude the day. Put a new date on its first row, leave the date blank only on subsequent rows of that contiguous day, and do not add monthly summary totals as jobs.

The compact format is `machine-production-template-v1`; it rejects populated data columns beyond I and unknown/changed headers. The prior A–AS monthly format remains supported, including existing WH-C cached-formula handling and provenance, when its heading matches the selected machine. Both use kg and at most three decimals. Other units/layouts require an explicit mapping; do not relabel counts as kg. The original workbook stays with its owner; private parsed source cells are retained, not the workbook bytes.

## Process trends

1. Open the machine → **Process trends → Import synthetic readings**.
2. **Download Excel template** provides an empty Guide and Hourly_Readings sheet with that machine's code in Guide B5.
3. Preserve the Guide and exact headers. Each data row needs a unique reading_id, matching machine_id, whole-hour IST local timestamp, demo shift, three numeric parameters and SYNTHETIC source.
4. Preview, review excluded rows, acknowledge the demonstration limitations and import valid observations. Review the saved trends after import.

The standard profile contains **hot temperature °C, cold temperature °C and pressure bar**. It retains the original invented A/B/C shift schedule, invented bands, gap handling and separate measurement/receipt times. Its review columns are provenance only; calculations do not use workbook formula flags. It remains synthetic software-demonstration data and supplies no validated machine limits or actual fault causes. Other process parameters, other units and authentic process-data support need a reviewed mapping/contract. Do not put unrelated values into temperature/pressure columns or present real plant measurements as synthetic.

## Roles, scope and persistence

Administrator, Maintenance head and Supervisor can download templates and inspect/preview/commit imports, matching existing import authority. Operators/Technicians can read their granted machines' saved data; Management reads within the organization. Templates create no machine grants, role authority, import rows or observations. No automatic incidents, fault conclusions or email enrollment follow from downloads/imports.

The API rejects another machine's production heading or process Guide and excludes wrong-machine process rows. Identical dates/reading IDs on different machines remain separate; cross-machine preview/commit IDs are unavailable. All original source/measurement/receipt/audit and retry guarantees remain. The private schema/grants are unchanged.

Endpoints: `GET /api/machines/:code/production/template?month=YYYY-MM`, `GET /api/machines/:code/readings/template`, and the existing machine-scoped preview/commit/dashboard routes. Downloads require authentication/import roles and fresh machine scope; the XLSX response is prepared only after authorization succeeds. No schema migration is needed.

The owner subsequently supplied and confirmed a separate WHB company workbook. Its reviewed `whb-monthly-production-v1` mapping (including AT remarks and AG–AS downtime) is documented in PRODUCTION-IMPORT.md. This is a specific additional mapping, not a change to the standard nine-column template or a general acceptance of custom layouts.
