-- Run as migration owner after migrate. Create the runtime LOGIN separately,
-- using a private password. Pass: psql "$DIRECT_URL" -v runtime_role=... -f ...
REVOKE ALL ON SCHEMA maintenance FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA maintenance FROM PUBLIC;
GRANT USAGE ON SCHEMA maintenance TO :"runtime_role";
GRANT SELECT ON ALL TABLES IN SCHEMA maintenance TO :"runtime_role";
-- Registry, memberships and protected history stay read-only. Imports get narrow append permissions.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA maintenance FROM :"runtime_role";

GRANT INSERT ON maintenance."ProductionImport", maintenance."ProductionDay", maintenance."ProductionRow", maintenance."AuditEvent" TO :"runtime_role";
GRANT UPDATE (status, "committedAt", "committedDayKeys") ON maintenance."ProductionImport" TO :"runtime_role";

GRANT INSERT ON maintenance."ReadingImport", maintenance."ProcessReading" TO :"runtime_role";
GRANT UPDATE (status, "committedAt") ON maintenance."ReadingImport" TO :"runtime_role";

GRANT INSERT ON maintenance."WorkOrder", maintenance."WorkOrderEvent" TO :"runtime_role";
GRANT UPDATE (status, version, "technicianId", "startedAt", findings, "rootCause", "correctiveAction", "preventiveAction", "restoredAt", "submittedAt", "returnReason", "reviewedAt", "reviewedBy", "closedAt", "closedBy", "updatedAt") ON maintenance."WorkOrder" TO :"runtime_role";

GRANT INSERT ON maintenance."MaintenancePlan", maintenance."MaintenanceOccurrence", maintenance."MaintenanceReminder", maintenance."MaintenanceReminderReceipt" TO :"runtime_role";
GRANT UPDATE (active, version, "pauseReason", "nextSequence", "lastGeneratedAt", "updatedAt") ON maintenance."MaintenancePlan" TO :"runtime_role";
GRANT UPDATE (version, "skippedAt", "skippedBy", "skipReason") ON maintenance."MaintenanceOccurrence" TO :"runtime_role";
GRANT UPDATE ("performedAt", "investigationOutcome") ON maintenance."WorkOrder" TO :"runtime_role";

GRANT INSERT ON maintenance."AnomalyReview" TO :"runtime_role";
GRANT INSERT ON maintenance."WorkOrderAttachment" TO :"runtime_role";

GRANT INSERT ON maintenance."WorkOrderNotificationReceipt" TO :"runtime_role";
