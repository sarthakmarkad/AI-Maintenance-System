# Data boundaries

Original files remain under ignored `Maintenance_Handoff/data`; no company workbook has been copied into source, Git or public assets. Future originals belong in private storage; storage persistence is not implemented yet.

## Authentic production workbooks

WH-C is the pilot; WH-B is reference-only and is not declared decommissioned. Multiple job rows can share a shift. Preserve raw composite job descriptions and source workbook/sheet/row. Parsing dimensions/material/customer is provisional until notation is validated.

`Production KGS` rows contribute production; `PROD TOTAL` is a daily reconciliation control, not extra production. Scrap is kg, with causes and daily controls. Downtime has cause codes but **unconfirmed units**; no conversion or availability metric yet. A/B/C shifts are each eight hours; actual start times/reporting-day boundary remain unconfirmed. Do not invent timestamps from daily/shift totals.

Review merged headers, layout changes, overlapping monthly/EPL tabs and inconsistent machine headings. Flag ambiguous dates/numbers; WH-C SEP-2026 A57 contains `08-0-2026`, which must not be silently corrected. Remarks are context, not automatically approved engineering RCA.

## Synthetic readings workbook

336 synthetic hourly observations across 1–14 September 2026; 1,008 hot/cold/pressure values. Local measurement times are Asia/Kolkata. Guide, Hourly_Readings and Demo_Events are separate; all observations are SYNTHETIC. Demo shifts 00–08 / 08–16 / 16–24 are invented and do not establish actual shifts.

Father-reported temperature 30–290 (assuming °C) and pressure 0–600 bar are **unverified reported ranges**. They are neither validated safe limits nor normal operating bands; sensor locations and sharing the temperature range are unconfirmed.

Demo nominal values 200°C / 45°C / 100 bar and review bands 180–220 / 40–50 / 80–120 are invented demonstration assumptions. Keep them distinct from reported ranges and future verified engineering limits. Do not seed them as authoritative machine settings.

Hourly snapshots miss between-sample events. Imported readings support retrospective analysis; measured_at and received/imported_at must remain distinct. Operator reports are the application's immediate incident input. A single unusual sample does not create a confirmed breakdown or emergency alarm. There is no direct second-by-second telemetry/SAP integration.

Never use synthetic readings to explain authentic production loss or claim validated industrial prediction accuracy. Demo event labels and derived review flags must be excluded from ML input features.
