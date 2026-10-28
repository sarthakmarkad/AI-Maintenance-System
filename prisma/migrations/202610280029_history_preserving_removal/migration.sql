ALTER TABLE maintenance."Machine" ADD COLUMN "archivedAt" timestamptz(3), ADD COLUMN "archiveReason" varchar(4000);
ALTER TABLE maintenance."Machine" ADD CONSTRAINT machine_archive_reason CHECK (
 ("archivedAt" IS NULL AND "archiveReason" IS NULL) OR
 ("archivedAt" IS NOT NULL AND "archiveReason" IS NOT NULL AND length(btrim("archiveReason")) BETWEEN 3 AND 4000)
);
CREATE INDEX machine_archive_list ON maintenance."Machine" ("orgId","archivedAt",code);

CREATE FUNCTION maintenance.check_machine_archive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."archivedAt" IS NOT NULL AND OLD."archivedAt" IS NULL THEN
   IF EXISTS (SELECT 1 FROM maintenance."WorkOrder" WHERE "machineId"=NEW.id AND status NOT IN ('CLOSED','CANCELLED')) OR
      EXISTS (SELECT 1 FROM maintenance."MaintenancePlan" WHERE "machineId"=NEW.id AND active) OR
      EXISTS (SELECT 1 FROM maintenance."MaintenanceOccurrence" o WHERE o."machineId"=NEW.id AND o."skippedAt" IS NULL AND NOT EXISTS (
        SELECT 1 FROM maintenance."WorkOrder" w WHERE w."occurrenceId"=o.id AND w.status IN ('CLOSED','CANCELLED')
      )) THEN RAISE EXCEPTION 'Resolve open work, pause plans and skip outstanding tasks before archiving'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER machine_archive_check BEFORE UPDATE ON maintenance."Machine" FOR EACH ROW EXECUTE FUNCTION maintenance.check_machine_archive();
CREATE FUNCTION maintenance.check_machine_archive_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" AND NOT EXISTS (
  SELECT 1 FROM maintenance."AuditEvent" a JOIN maintenance."Machine" m ON m.id=NEW.id
  WHERE a."entityId"=NEW.id::text AND a."orgId"=NEW."orgId" AND
   a.action=CASE WHEN NEW."archivedAt" IS NULL THEN 'MACHINE_RESTORE' ELSE 'MACHINE_ARCHIVE' END AND
   a.detail->>'actorRole'='ADMINISTRATOR' AND a.detail->>'version'=m.version::text AND
   length(btrim(a.detail->'evidence'->>'reason')) BETWEEN 3 AND 4000
 ) THEN RAISE EXCEPTION 'Machine archival requires administrator audit'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER machine_archive_audit AFTER UPDATE ON maintenance."Machine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION maintenance.check_machine_archive_audit();

-- Serialize new operational writes with registry archival. Historical reads stay available.
CREATE FUNCTION maintenance.require_active_machine() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE archived timestamptz;
BEGIN
 SELECT "archivedAt" INTO archived FROM maintenance."Machine" WHERE id=NEW."machineId" AND "orgId"=NEW."orgId" FOR SHARE;
 IF archived IS NOT NULL THEN RAISE EXCEPTION 'Archived machines are read only'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['WorkOrder','MaintenancePlan','MaintenanceOccurrence','ProductionImport','ProductionDay','ProductionRow','ReadingImport','ProcessReading','AnomalyReview','MachineDocument','MachineDocumentFile','MachineDocumentEvent','DocumentChat','DocumentChatTurn','WorkOrderAttachment'] LOOP
 EXECUTE format('CREATE TRIGGER active_machine_insert BEFORE INSERT ON maintenance.%I FOR EACH ROW EXECUTE FUNCTION maintenance.require_active_machine()',t);
 END LOOP;
END $$;
CREATE TRIGGER active_machine_plan_update BEFORE UPDATE ON maintenance."MaintenancePlan" FOR EACH ROW EXECUTE FUNCTION maintenance.require_active_machine();

CREATE TABLE maintenance."DocumentChatArchive" (
 "chatId" uuid PRIMARY KEY, "orgId" uuid NOT NULL, "machineId" uuid NOT NULL,
 "userId" uuid NOT NULL, "actorRole" maintenance."Role" NOT NULL,
 at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("orgId","machineId","userId","actorRole","chatId"),
 FOREIGN KEY ("orgId","machineId","userId","actorRole","chatId") REFERENCES maintenance."DocumentChat"("orgId","machineId","userId","actorRole",id) ON DELETE RESTRICT
);
CREATE TRIGGER chat_archive_immutable BEFORE UPDATE OR DELETE ON maintenance."DocumentChatArchive" FOR EACH ROW EXECUTE FUNCTION maintenance.prevent_audit_change();
CREATE FUNCTION maintenance.check_chat_archive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM maintenance."AuditEvent" a WHERE a."orgId"=NEW."orgId" AND a."actorId"=NEW."userId" AND a."entityId"=NEW."chatId"::text AND a.action='DOCUMENT_CHAT_ARCHIVE' AND a.detail->>'actorRole'=NEW."actorRole"::text) THEN RAISE EXCEPTION 'Chat archive requires audit'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER chat_archive_audit AFTER INSERT ON maintenance."DocumentChatArchive" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION maintenance.check_chat_archive();
REVOKE ALL ON maintenance."DocumentChatArchive" FROM PUBLIC;
CREATE FUNCTION maintenance.check_chat_not_archived() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM maintenance."DocumentChatArchive" WHERE "chatId"=NEW."chatId") THEN RAISE EXCEPTION 'Conversation was removed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER chat_turn_active BEFORE INSERT ON maintenance."DocumentChatTurn" FOR EACH ROW EXECUTE FUNCTION maintenance.check_chat_not_archived();

-- Extend cancellation to every work kind without altering its original evidence.
CREATE OR REPLACE FUNCTION maintenance.check_work_order_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.version <> OLD.version+1 OR OLD.status IN ('CLOSED','CANCELLED') THEN RAISE EXCEPTION 'Invalid work order version or terminal state'; END IF;
 IF NEW.status=OLD.status AND OLD.status IN ('REPORTED','IN_PROGRESS') AND
    (to_jsonb(NEW)-'version'-'updatedAt')=(to_jsonb(OLD)-'version'-'updatedAt') THEN RETURN NEW; END IF;
 IF NEW.status='CANCELLED' AND OLD.status IN ('REPORTED','ASSIGNED','IN_PROGRESS','AWAITING_REVIEW') AND
    (to_jsonb(NEW)-'version'-'updatedAt'-'status')=(to_jsonb(OLD)-'version'-'updatedAt'-'status') THEN RETURN NEW; END IF;
 IF NOT ((OLD.status='REPORTED' AND NEW.status='ASSIGNED') OR (OLD.status='ASSIGNED' AND NEW.status IN ('ASSIGNED','IN_PROGRESS')) OR (OLD.status='IN_PROGRESS' AND NEW.status IN ('ASSIGNED','AWAITING_REVIEW')) OR (OLD.status='AWAITING_REVIEW' AND NEW.status IN ('IN_PROGRESS','APPROVED')) OR (OLD.status='APPROVED' AND NEW.status='CLOSED')) THEN RAISE EXCEPTION 'Invalid work order state transition'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION maintenance.check_cancel_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='CANCELLED' AND NOT EXISTS (
  SELECT 1 FROM maintenance."WorkOrderEvent" e JOIN maintenance."AuditEvent" a ON
   a."entityId"=e."orderId"::text AND a."orgId"=e."orgId" AND a."actorId"=e."actorId" AND a.action='WORK_ORDER_CANCEL' AND a.detail->>'version'=e.version::text
  WHERE e."orderId"=NEW.id AND e.version=NEW.version AND e.action='CANCEL' AND e."actorRole"='MAINTENANCE_HEAD' AND e."toStatus"='CANCELLED' AND e."fromStatus"=OLD.status AND length(btrim(e.detail->>'reason')) BETWEEN 3 AND 4000
 ) THEN RAISE EXCEPTION 'Cancellation requires head reason and audit'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER cancellation_evidence AFTER UPDATE ON maintenance."WorkOrder" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION maintenance.check_cancel_evidence();
REVOKE ALL ON FUNCTION maintenance.check_machine_archive(),maintenance.check_machine_archive_audit(),maintenance.require_active_machine(),maintenance.check_chat_archive(),maintenance.check_chat_not_archived(),maintenance.check_cancel_evidence() FROM PUBLIC;
