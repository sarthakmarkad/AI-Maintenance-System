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
GRANT INSERT ON maintenance."MachineDocument", maintenance."MachineDocumentFile", maintenance."MachineDocumentEvent" TO :"runtime_role";
GRANT UPDATE (version) ON maintenance."MachineDocument" TO :"runtime_role";

GRANT USAGE ON SCHEMA extensions TO :"runtime_role";
GRANT INSERT ON maintenance."DocumentRagIndex", maintenance."DocumentRagChunk" TO :"runtime_role";
GRANT UPDATE (status, attempts, "leaseId", "leaseUntil", "nextAttemptAt", "pageCount", "chunkCount", "lastError", "readyAt", "updatedAt") ON maintenance."DocumentRagIndex" TO :"runtime_role";

GRANT INSERT ON maintenance."DocumentChat",maintenance."DocumentChatTurn" TO :"runtime_role";
GRANT UPDATE(version,"updatedAt") ON maintenance."DocumentChat" TO :"runtime_role";

-- Optional external email: append-only preferences/attempts and bounded outbox transitions.
GRANT INSERT ON maintenance."ExternalNotificationPreference",maintenance."ExternalNotificationOutbox",maintenance."ExternalNotificationAttempt" TO :"runtime_role";
GRANT UPDATE(status,"attemptCount","nextAttemptAt","firstAttemptAt","leaseToken","leaseUntil","providerId",code,"updatedAt") ON maintenance."ExternalNotificationOutbox" TO :"runtime_role";
GRANT EXECUTE ON FUNCTION maintenance.external_notification_access(UUID,UUID,UUID,maintenance."Role"),
 maintenance.external_notification_actionable(UUID,UUID,UUID,UUID,maintenance."Role"),maintenance.external_notification_current(UUID),
 maintenance.check_external_preference(),maintenance.check_external_outbox(),maintenance.audit_external_notification(),
 maintenance.check_external_attempt(),maintenance.audit_external_late_result() TO :"runtime_role";

-- AI drafting cannot edit the work order or previously retained draft evidence.
GRANT INSERT ON maintenance."RcaDraftRequest",maintenance."RcaDraftReceipt" TO :"runtime_role";
GRANT EXECUTE ON FUNCTION maintenance.rca_draft_immutable(),maintenance.rca_request_eligible() TO :"runtime_role";
GRANT EXECUTE ON FUNCTION maintenance.check_rca_request_audit(),maintenance.check_rca_receipt_audit() TO :"runtime_role";

-- Registry administration is API-authorized independently of engineering roles.
GRANT INSERT ON maintenance."Machine",maintenance."Department",maintenance."Location",maintenance."MachineAccess" TO :"runtime_role";
GRANT UPDATE (version,"updatedAt") ON maintenance."Machine" TO :"runtime_role";
GRANT DELETE ON maintenance."MachineAccess" TO :"runtime_role";

-- Current registry presentation; immutable original reports/history remain protected.
GRANT UPDATE (name,manufacturer,model,"departmentId","locationId") ON maintenance."Machine" TO :"runtime_role";
GRANT INSERT, DELETE ON maintenance."MachinePhoto" TO :"runtime_role";
GRANT UPDATE ("archivedAt","archiveReason") ON maintenance."Machine" TO :"runtime_role";
GRANT INSERT ON maintenance."DocumentChatArchive" TO :"runtime_role";

-- Audited private staff administration; identity tables remain directly read-only.
GRANT EXECUTE ON FUNCTION maintenance.team_admin_action(uuid,uuid,uuid,text,uuid,jsonb),maintenance.team_accept_invitation(uuid,uuid,text),maintenance.team_email_result(uuid,text,text,text) TO :"runtime_role";
