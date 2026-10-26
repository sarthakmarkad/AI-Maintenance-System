CREATE TABLE maintenance."DocumentChat" (
 id UUID PRIMARY KEY, "orgId" UUID NOT NULL, "machineId" UUID NOT NULL, "userId" UUID NOT NULL,
 "actorRole" maintenance."Role" NOT NULL, title VARCHAR(80) NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
 version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 60),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("orgId","machineId","userId","actorRole",id),
 FOREIGN KEY("orgId","machineId") REFERENCES maintenance."Machine"("orgId",id) ON DELETE RESTRICT,
 FOREIGN KEY("orgId","userId") REFERENCES maintenance."Membership"("orgId","userId") ON DELETE RESTRICT
);
CREATE INDEX "DocumentChat_owner_updated_idx" ON maintenance."DocumentChat"("orgId","machineId","userId","actorRole","updatedAt",id);
CREATE TABLE maintenance."DocumentChatTurn" (
 id UUID PRIMARY KEY, "orgId" UUID NOT NULL, "machineId" UUID NOT NULL, "userId" UUID NOT NULL,
 "actorRole" maintenance."Role" NOT NULL, "chatId" UUID NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 60),
 "requestId" UUID NOT NULL, fingerprint VARCHAR(64) NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 question VARCHAR(1000) NOT NULL CHECK(length(question) BETWEEN 1 AND 1000),
 answer JSONB NOT NULL CHECK(jsonb_typeof(answer)='object' AND octet_length(answer::text)<=65536),
 at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("chatId",ordinal), UNIQUE("orgId","machineId","userId","actorRole","requestId"),
 FOREIGN KEY("orgId","machineId","userId","actorRole","chatId") REFERENCES maintenance."DocumentChat"("orgId","machineId","userId","actorRole",id) ON DELETE RESTRICT
);
CREATE TRIGGER document_chat_turn_immutable BEFORE UPDATE OR DELETE ON maintenance."DocumentChatTurn" FOR EACH ROW EXECUTE FUNCTION maintenance.prevent_audit_change();
CREATE FUNCTION maintenance.check_document_chat_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (NEW.id,NEW."orgId",NEW."machineId",NEW."userId",NEW."actorRole",NEW.title,NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."orgId",OLD."machineId",OLD."userId",OLD."actorRole",OLD.title,OLD."createdAt") THEN RAISE EXCEPTION 'Chat ownership and title are immutable'; END IF;
 IF NEW.version<>OLD.version+1 OR NEW."updatedAt"<OLD."updatedAt" THEN RAISE EXCEPTION 'Chat version must advance once'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_chat_change BEFORE UPDATE OR DELETE ON maintenance."DocumentChat" FOR EACH ROW EXECUTE FUNCTION maintenance.check_document_chat_change();
CREATE FUNCTION maintenance.check_document_chat_complete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (SELECT count(*) FROM maintenance."DocumentChatTurn" WHERE "chatId"=NEW.id)<>NEW.version THEN RAISE EXCEPTION 'Chat version requires complete turns'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER document_chat_complete AFTER INSERT OR UPDATE ON maintenance."DocumentChat" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION maintenance.check_document_chat_complete();
CREATE FUNCTION maintenance.check_document_chat_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM maintenance."AuditEvent" a WHERE a."orgId"=NEW."orgId" AND a."actorId"=NEW."userId" AND a."entityId"=NEW.id AND a.action='DOCUMENT_CHAT_TURN' AND a.detail->>'chatId'=NEW."chatId"::text AND a.detail->>'actorRole'=NEW."actorRole"::text) THEN RAISE EXCEPTION 'Chat turn requires protected audit'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER document_chat_audit AFTER INSERT ON maintenance."DocumentChatTurn" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION maintenance.check_document_chat_audit();
REVOKE ALL ON maintenance."DocumentChat",maintenance."DocumentChatTurn" FROM PUBLIC;
