CREATE TABLE maintenance."WorkOrderAttachment" (
 "id" UUID PRIMARY KEY,
 "orgId" UUID NOT NULL,
 "machineId" UUID NOT NULL,
 "orderId" UUID NOT NULL,
 "orderVersion" INTEGER NOT NULL,
 "requestId" UUID NOT NULL,
 "fingerprint" VARCHAR(64) NOT NULL,
 "filename" VARCHAR(160) NOT NULL,
 "description" VARCHAR(1000) NOT NULL,
 "mediaType" VARCHAR(32) NOT NULL,
 "byteSize" INTEGER NOT NULL,
 "sha256" VARCHAR(64) NOT NULL,
 "content" BYTEA NOT NULL,
 "uploadedBy" UUID NOT NULL,
 "uploaderName" VARCHAR(120) NOT NULL,
 "actorRole" maintenance."Role" NOT NULL,
 "status" maintenance."WorkOrderStatus" NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT attachment_bytes CHECK ("byteSize" BETWEEN 1 AND 5242880 AND octet_length(content)="byteSize" AND "sha256"=encode(sha256(content),'hex')),
 CONSTRAINT attachment_metadata CHECK (length(btrim(filename)) BETWEEN 1 AND 160 AND length(btrim(description)) BETWEEN 3 AND 1000 AND length(btrim("uploaderName"))>0 AND fingerprint ~ '^[a-f0-9]{64}$' AND "mediaType" IN ('image/jpeg','image/png','application/pdf')),
 CONSTRAINT attachment_stage CHECK (("actorRole"='OPERATOR' AND status='REPORTED') OR ("actorRole"='TECHNICIAN' AND status='IN_PROGRESS')),
 CONSTRAINT "WorkOrderAttachment_order_fkey" FOREIGN KEY ("orgId","machineId","orderId") REFERENCES maintenance."WorkOrder"("orgId","machineId",id) ON DELETE RESTRICT,
 CONSTRAINT "WorkOrderAttachment_uploader_fkey" FOREIGN KEY ("orgId","uploadedBy") REFERENCES maintenance."Membership"("orgId","userId") ON DELETE RESTRICT,
 CONSTRAINT "WorkOrderAttachment_event_fkey" FOREIGN KEY ("orderId","orderVersion") REFERENCES maintenance."WorkOrderEvent"("orderId",version) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "WorkOrderAttachment_orderId_orderVersion_key" ON maintenance."WorkOrderAttachment"("orderId","orderVersion");
CREATE UNIQUE INDEX "WorkOrderAttachment_orgId_orderId_uploadedBy_requestId_key" ON maintenance."WorkOrderAttachment"("orgId","orderId","uploadedBy","requestId");
CREATE INDEX "WorkOrderAttachment_orgId_machineId_orderId_createdAt_id_idx" ON maintenance."WorkOrderAttachment"("orgId","machineId","orderId","createdAt",id);
CREATE TRIGGER work_order_attachment_immutable BEFORE UPDATE OR DELETE ON maintenance."WorkOrderAttachment" FOR EACH ROW EXECUTE FUNCTION maintenance.prevent_audit_change();

ALTER TABLE maintenance."WorkOrderEvent" DROP CONSTRAINT work_order_event_action;
ALTER TABLE maintenance."WorkOrderEvent" ADD CONSTRAINT work_order_event_action CHECK (action IN ('REPORT','SCHEDULE','INVESTIGATE','ASSIGN','START','SUBMIT','APPROVE','RETURN','CLOSE','ATTACH') AND version>0);

-- A same-stage evidence addition may change only version/update time. All other
-- existing workflow transitions and terminal closure rules remain intact.
CREATE OR REPLACE FUNCTION maintenance.check_work_order_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.version <> OLD.version+1 OR OLD.status='CLOSED' THEN RAISE EXCEPTION 'Invalid work order version or terminal state'; END IF;
 IF NEW.status=OLD.status AND OLD.status IN ('REPORTED','IN_PROGRESS') AND
    (to_jsonb(NEW)-'version'-'updatedAt')=(to_jsonb(OLD)-'version'-'updatedAt') THEN
   RETURN NEW;
 END IF;
 IF NOT ((OLD.status='REPORTED' AND NEW.status='ASSIGNED') OR (OLD.status='ASSIGNED' AND NEW.status IN ('ASSIGNED','IN_PROGRESS')) OR (OLD.status='IN_PROGRESS' AND NEW.status IN ('ASSIGNED','AWAITING_REVIEW')) OR (OLD.status='AWAITING_REVIEW' AND NEW.status IN ('IN_PROGRESS','APPROVED')) OR (OLD.status='APPROVED' AND NEW.status='CLOSED')) THEN RAISE EXCEPTION 'Invalid work order state transition'; END IF;
 RETURN NEW;
END $$;

-- Fail commit if a same-stage version bump has no matching immutable evidence.
CREATE FUNCTION maintenance.check_attachment_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status=OLD.status AND OLD.status IN ('REPORTED','IN_PROGRESS') AND NOT EXISTS (
   SELECT 1 FROM maintenance."WorkOrderAttachment" a WHERE a."orderId"=NEW.id AND a."orderVersion"=NEW.version
 ) THEN RAISE EXCEPTION 'Evidence version requires an attachment'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER work_order_attachment_version AFTER UPDATE ON maintenance."WorkOrder" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION maintenance.check_attachment_version();

CREATE FUNCTION maintenance.check_attachment_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o maintenance."WorkOrder";
BEGIN
 SELECT * INTO o FROM maintenance."WorkOrder" WHERE id=NEW."orderId" FOR UPDATE;
 IF o.version<>NEW."orderVersion" OR o.status<>NEW.status OR NEW."createdAt"<>o."updatedAt" OR
    (NEW."actorRole"='OPERATOR' AND o."reportedBy"<>NEW."uploadedBy") OR
    (NEW."actorRole"='TECHNICIAN' AND o."technicianId" IS DISTINCT FROM NEW."uploadedBy") OR
    NOT EXISTS (SELECT 1 FROM maintenance."WorkOrderEvent" e WHERE e."orderId"=NEW."orderId" AND e.version=NEW."orderVersion" AND e.action='ATTACH' AND e."actorId"=NEW."uploadedBy" AND e."actorRole"=NEW."actorRole" AND e."actorName"=NEW."uploaderName" AND e."fromStatus"=NEW.status AND e."toStatus"=NEW.status AND e.at=NEW."createdAt" AND e.detail->>'attachmentId'=NEW.id::text) THEN
   RAISE EXCEPTION 'Invalid attachment evidence linkage';
 END IF;
 IF (SELECT count(*) FROM maintenance."WorkOrderAttachment" WHERE "orderId"=NEW."orderId")>=20 THEN RAISE EXCEPTION 'Attachment count limit exceeded'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER work_order_attachment_insert BEFORE INSERT ON maintenance."WorkOrderAttachment" FOR EACH ROW EXECUTE FUNCTION maintenance.check_attachment_insert();
REVOKE ALL ON maintenance."WorkOrderAttachment" FROM PUBLIC;
