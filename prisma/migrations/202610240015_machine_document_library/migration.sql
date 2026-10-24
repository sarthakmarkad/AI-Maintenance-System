-- Private machine references: immutable files and append-only lifecycle evidence.
CREATE TABLE maintenance."MachineDocument" (
 id UUID PRIMARY KEY, "orgId" UUID NOT NULL, "machineId" UUID NOT NULL,
 title VARCHAR(160) NOT NULL CHECK(length(btrim(title)) BETWEEN 3 AND 160),
 kind VARCHAR(16) NOT NULL CHECK(kind IN ('MANUAL','SOP')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("orgId","machineId",id),
 FOREIGN KEY("orgId","machineId") REFERENCES maintenance."Machine"("orgId",id) ON DELETE RESTRICT
);
CREATE INDEX "MachineDocument_orgId_machineId_createdAt_id_idx" ON maintenance."MachineDocument"("orgId","machineId","createdAt",id);
CREATE TABLE maintenance."MachineDocumentFile" (
 id UUID PRIMARY KEY, "orgId" UUID NOT NULL, "machineId" UUID NOT NULL, "documentId" UUID NOT NULL,
 number INTEGER NOT NULL CHECK(number BETWEEN 1 AND 100),
 filename VARCHAR(160) NOT NULL CHECK(length(btrim(filename)) BETWEEN 1 AND 160),
 description VARCHAR(1000) NOT NULL CHECK(length(btrim(description)) BETWEEN 3 AND 1000),
 "byteSize" INTEGER NOT NULL, sha256 VARCHAR(64) NOT NULL, content BYTEA NOT NULL,
 CONSTRAINT document_bytes CHECK("byteSize" BETWEEN 1 AND 5242880 AND octet_length(content)="byteSize" AND sha256=encode(sha256(content),'hex')),
 UNIQUE("orgId","machineId","documentId",id), UNIQUE("documentId",number),
 FOREIGN KEY("orgId","machineId","documentId") REFERENCES maintenance."MachineDocument"("orgId","machineId",id) ON DELETE RESTRICT
);
CREATE TABLE maintenance."MachineDocumentEvent" (
 id UUID PRIMARY KEY, "orgId" UUID NOT NULL, "machineId" UUID NOT NULL, "documentId" UUID NOT NULL, "fileId" UUID NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), action VARCHAR(16) NOT NULL CHECK(action IN ('UPLOAD','APPROVE','WITHDRAW')),
 reason VARCHAR(1000) NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 1000),
 "actorId" UUID NOT NULL, "actorName" VARCHAR(120) NOT NULL CHECK(length(btrim("actorName"))>0), "actorRole" maintenance."Role" NOT NULL,
 "requestId" UUID NOT NULL, fingerprint VARCHAR(64) NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'), at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT document_authority CHECK((action='UPLOAD' AND "actorRole" IN ('ADMINISTRATOR','MAINTENANCE_HEAD')) OR (action IN ('APPROVE','WITHDRAW') AND "actorRole"='MAINTENANCE_HEAD')),
 UNIQUE("documentId",revision), UNIQUE("orgId","machineId","actorId","requestId"),
 FOREIGN KEY("orgId","machineId","documentId") REFERENCES maintenance."MachineDocument"("orgId","machineId",id) ON DELETE RESTRICT,
 FOREIGN KEY("orgId","machineId","documentId","fileId") REFERENCES maintenance."MachineDocumentFile"("orgId","machineId","documentId",id) ON DELETE RESTRICT,
 FOREIGN KEY("orgId","actorId") REFERENCES maintenance."Membership"("orgId","userId") ON DELETE RESTRICT
);
CREATE TRIGGER machine_document_file_immutable BEFORE UPDATE OR DELETE ON maintenance."MachineDocumentFile" FOR EACH ROW EXECUTE FUNCTION maintenance.prevent_audit_change();
CREATE TRIGGER machine_document_event_immutable BEFORE UPDATE OR DELETE ON maintenance."MachineDocumentEvent" FOR EACH ROW EXECUTE FUNCTION maintenance.prevent_audit_change();
CREATE FUNCTION maintenance.check_document_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reference evidence cannot be deleted'; END IF;
 IF NEW.version<>OLD.version+1 OR (to_jsonb(NEW)-'version')<>(to_jsonb(OLD)-'version') THEN RAISE EXCEPTION 'Only reference version may advance'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER machine_document_update BEFORE UPDATE OR DELETE ON maintenance."MachineDocument" FOR EACH ROW EXECUTE FUNCTION maintenance.check_document_update();
CREATE FUNCTION maintenance.check_document_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d maintenance."MachineDocument"; last_event maintenance."MachineDocumentEvent"; n INTEGER;
BEGIN
 SELECT * INTO d FROM maintenance."MachineDocument" WHERE id=NEW."documentId" FOR UPDATE;
 SELECT count(*) INTO n FROM maintenance."MachineDocumentEvent" WHERE "documentId"=d.id;
 IF NEW.revision<>d.version OR NEW.revision<>n+1 THEN RAISE EXCEPTION 'Reference evidence version mismatch'; END IF;
 IF NEW.action='UPLOAD' THEN
   IF EXISTS(SELECT 1 FROM maintenance."MachineDocumentEvent" WHERE "fileId"=NEW."fileId") THEN RAISE EXCEPTION 'File was already uploaded'; END IF;
   IF (SELECT number FROM maintenance."MachineDocumentFile" WHERE id=NEW."fileId")<>(SELECT count(*) FROM maintenance."MachineDocumentFile" WHERE "documentId"=d.id) THEN RAISE EXCEPTION 'Reference sequence mismatch'; END IF;
 ELSE
   IF NOT EXISTS(SELECT 1 FROM maintenance."MachineDocumentEvent" WHERE "fileId"=NEW."fileId" AND action='UPLOAD') THEN RAISE EXCEPTION 'Reference upload evidence missing'; END IF;
   IF NEW.action='APPROVE' AND EXISTS(SELECT 1 FROM maintenance."MachineDocumentEvent" WHERE "fileId"=NEW."fileId" AND action<>'UPLOAD') THEN RAISE EXCEPTION 'Only a draft may be approved'; END IF;
   SELECT * INTO last_event FROM maintenance."MachineDocumentEvent" WHERE "documentId"=d.id AND action<>'UPLOAD' ORDER BY revision DESC LIMIT 1;
   IF NEW.action='WITHDRAW' AND (last_event.action IS DISTINCT FROM 'APPROVE' OR last_event."fileId" IS DISTINCT FROM NEW."fileId") THEN RAISE EXCEPTION 'Only current approval may be withdrawn'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER machine_document_event_check BEFORE INSERT ON maintenance."MachineDocumentEvent" FOR EACH ROW EXECUTE FUNCTION maintenance.check_document_event();
CREATE FUNCTION maintenance.check_document_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM maintenance."MachineDocumentEvent" WHERE "documentId"=NEW.id AND revision=NEW.version) THEN RAISE EXCEPTION 'Reference version requires immutable event'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER machine_document_evidence AFTER INSERT OR UPDATE ON maintenance."MachineDocument" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION maintenance.check_document_evidence();
CREATE FUNCTION maintenance.check_document_file_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM maintenance."MachineDocumentEvent" WHERE "fileId"=NEW.id AND action='UPLOAD') THEN RAISE EXCEPTION 'Reference file requires upload evidence'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER machine_document_file_evidence AFTER INSERT ON maintenance."MachineDocumentFile" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION maintenance.check_document_file_evidence();
-- Each lifecycle event and exact file hash also needs a protected audit in the same commit.
CREATE FUNCTION maintenance.check_document_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM maintenance."AuditEvent" a JOIN maintenance."MachineDocumentFile" f ON f.id=NEW."fileId"
   WHERE a."orgId"=NEW."orgId" AND a."actorId"=NEW."actorId" AND a."entityId"=NEW."documentId"::text AND a.action='MACHINE_DOCUMENT_'||NEW.action AND a.at=NEW.at
   AND a.detail->>'revision'=NEW.revision::text AND a.detail->>'fileId'=NEW."fileId"::text AND a.detail->>'actorRole'=NEW."actorRole"::text AND a.detail->'file'->>'sha256'=f.sha256)
 THEN RAISE EXCEPTION 'Reference event requires matching protected audit'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER machine_document_audit AFTER INSERT ON maintenance."MachineDocumentEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION maintenance.check_document_audit();
REVOKE ALL ON maintenance."MachineDocument",maintenance."MachineDocumentFile",maintenance."MachineDocumentEvent" FROM PUBLIC;
