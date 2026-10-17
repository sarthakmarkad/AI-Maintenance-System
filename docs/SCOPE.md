# Scope retained from the handoff

SRS v1.0 is the official baseline; its full text is unavailable here. This list is the handoff's intended overall functional scope, not a reconstruction of original authoritative requirements. Milestones 1–5 are intermediate deliveries.

| Functional area | Current status / intended delivery |
|---|---|
| 1 Machine/asset registry | M1: scoped registry reads and WH-C page |
| 2 Historical machine-data import | M2–3: production and synthetic hourly Excel preview, validation, duplicate-safe commit |
| 3 Machine performance dashboard | M2–3: persisted production/scrap totals and separate synthetic hourly trends |
| 4 Anomaly detection | Later: separate statistical/Python service |
| 5 Breakdown reporting | M4: scoped operator reports with protected original evidence |
| 6 Maintenance work orders | M4: persisted six-stage repair/review/closure workflow with atomic versions |
| 7 Technician assignment/tracking | M4: eligible roster, head assignment/reassignment and history |
| 8 Maintenance calendar/alerts | M5: fixed-date plans/calendar, due/overdue views, explicit release/skip and durable in-app reminders |
| 9 Complete maintenance history | M4: immutable, fully paged report/assignment/submission/review history; M5 planned occurrences/completion linked; later attachment history |
| 10 Human root-cause analysis | M4: required human findings/RCA/actions, head approval or reasoned return |
| 11 Advisory AI fault diagnosis | Later: backend provider abstraction |
| 12 Approved manual/SOP RAG | Later: private approved documents and grounded retrieval |
| 13 AI-assisted RCA drafting | Later: mandatory human approval |
| 14 Maintenance KPIs | Later: agreed definitions and verified units/runtime |
| 15 Management analytics | Later |
| 16 Reports/exports | Later |
| 17 Backend role-based access | M1: verified identity, trusted roles, org/record scope |
| 18 Notifications | M5: scoped due-stage in-app reminders/read receipts; external/other event delivery later |
| 19 Protected audit trail | M1–5: immutable seed/provisioning/import and work-order/calendar action/job events |
| 20 REST API/OpenAPI | M1–5: authenticated registry/import/trend/work-order/calendar/reminder endpoints, Swagger and generated frontend types |

Next implementation target: a separate statistical anomaly service. Calendar/role/work-order acceptance across independent staff identities remains distinct from the single-identity pilot. Supabase-hosted operational persistence is still pending. See CALENDAR.md and WORK-ORDERS.md for implemented pilot choices and verification boundaries.
