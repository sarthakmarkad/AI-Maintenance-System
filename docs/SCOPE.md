# Scope retained from the handoff

SRS v1.0 is the official baseline; its full text is unavailable here. This list is the handoff's intended overall functional scope, not a reconstruction of original authoritative requirements. Milestones 1–3 are intermediate deliveries.

| Functional area | Current status / intended delivery |
|---|---|
| 1 Machine/asset registry | M1: scoped registry reads and WH-C page |
| 2 Historical machine-data import | M2–3: production and synthetic hourly Excel preview, validation, duplicate-safe commit |
| 3 Machine performance dashboard | M2–3: persisted production/scrap totals and separate synthetic hourly trends |
| 4 Anomaly detection | Later: separate statistical/Python service |
| 5 Breakdown reporting | Later: operator reports |
| 6 Maintenance work orders | Later: persisted workflow; policy contract tested in M1 |
| 7 Technician assignment/tracking | Later: scoped assignments/history |
| 8 Maintenance calendar/alerts | Later |
| 9 Complete maintenance history | Later |
| 10 Human root-cause analysis | Later: maintenance-head review |
| 11 Advisory AI fault diagnosis | Later: backend provider abstraction |
| 12 Approved manual/SOP RAG | Later: private approved documents and grounded retrieval |
| 13 AI-assisted RCA drafting | Later: mandatory human approval |
| 14 Maintenance KPIs | Later: agreed definitions and verified units/runtime |
| 15 Management analytics | Later |
| 16 Reports/exports | Later |
| 17 Backend role-based access | M1: verified identity, trusted roles, org/record scope |
| 18 Notifications | Later |
| 19 Protected audit trail | M1–3: immutable seed/provisioning/production/reading import events; incident events later |
| 20 REST API/OpenAPI | M1–3: authenticated registry/production/reading REST endpoints, Swagger, generated frontend types |

Next acceptance target: persisted breakdown reporting, technician assignment and repair submission, human RCA, maintenance-head approval/return and supervisor/head closure. Preserve independent restoration/review/closure times, optimistic versions and atomic audit. Provisional state labels and required repair/RCA fields need validation against the confirmed responsibilities before freezing the workflow.
