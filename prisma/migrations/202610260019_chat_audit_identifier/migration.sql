-- AuditEvent.entityId is a generic varchar across domains; chat IDs are UUIDs.
CREATE OR REPLACE FUNCTION maintenance.check_document_chat_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM maintenance."AuditEvent" a WHERE a."orgId"=NEW."orgId" AND a."actorId"=NEW."userId" AND a."entityId"=NEW.id::text AND a.action='DOCUMENT_CHAT_TURN' AND a.detail->>'chatId'=NEW."chatId"::text AND a.detail->>'actorRole'=NEW."actorRole"::text) THEN RAISE EXCEPTION 'Chat turn requires protected audit'; END IF;
 RETURN NEW;
END $$;
