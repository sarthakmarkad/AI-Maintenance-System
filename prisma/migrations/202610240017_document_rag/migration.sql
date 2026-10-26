CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector' AND n.nspname='extensions') THEN
  RAISE EXCEPTION 'Install pgvector in the extensions schema before this migration';
 END IF;
END $$;
CREATE TABLE maintenance."DocumentRagIndex" (
 id UUID PRIMARY KEY, "orgId" UUID NOT NULL, "machineId" UUID NOT NULL, "documentId" UUID NOT NULL, "fileId" UUID NOT NULL,
 profile VARCHAR(160) NOT NULL, "sourceHash" VARCHAR(64) NOT NULL CHECK("sourceHash" ~ '^[a-f0-9]{64}$'),
 status VARCHAR(20) NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','PROCESSING','READY','FAILED','INACTIVE')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 100),
 "leaseId" UUID, "leaseUntil" TIMESTAMPTZ(3), "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "pageCount" INTEGER CHECK("pageCount" BETWEEN 1 AND 200), "chunkCount" INTEGER CHECK("chunkCount" BETWEEN 1 AND 500),
 "lastError" VARCHAR(80), "readyAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("fileId",profile), UNIQUE("orgId","machineId","documentId","fileId",id),
 FOREIGN KEY("orgId","machineId","documentId","fileId") REFERENCES maintenance."MachineDocumentFile"("orgId","machineId","documentId",id) ON DELETE RESTRICT,
 CHECK((status='PROCESSING' AND "leaseId" IS NOT NULL AND "leaseUntil" IS NOT NULL) OR (status<>'PROCESSING' AND "leaseId" IS NULL AND "leaseUntil" IS NULL)),
 CHECK(status<>'READY' OR ("pageCount" IS NOT NULL AND "chunkCount" IS NOT NULL AND "readyAt" IS NOT NULL AND "lastError" IS NULL))
);
CREATE INDEX "DocumentRagIndex_status_nextAttemptAt_idx" ON maintenance."DocumentRagIndex"(status,"nextAttemptAt");
CREATE TABLE maintenance."DocumentRagChunk" (
 id UUID PRIMARY KEY, "orgId" UUID NOT NULL, "machineId" UUID NOT NULL, "documentId" UUID NOT NULL, "fileId" UUID NOT NULL, "indexId" UUID NOT NULL,
 ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 499), page INTEGER NOT NULL CHECK(page BETWEEN 1 AND 200),
 text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 1200), hash VARCHAR(64) NOT NULL CHECK(hash=encode(sha256(convert_to(text,'UTF8')),'hex')),
 embedding extensions.vector(1536) NOT NULL,
 search tsvector GENERATED ALWAYS AS (to_tsvector('simple',text)) STORED,
 UNIQUE("indexId",ordinal),
 FOREIGN KEY("orgId","machineId","documentId","fileId","indexId") REFERENCES maintenance."DocumentRagIndex"("orgId","machineId","documentId","fileId",id) ON DELETE RESTRICT
);
CREATE INDEX "DocumentRagChunk_scope_index_idx" ON maintenance."DocumentRagChunk"("orgId","machineId","indexId");
CREATE INDEX "DocumentRagChunk_search_idx" ON maintenance."DocumentRagChunk" USING GIN(search);
CREATE TRIGGER document_rag_chunk_immutable BEFORE UPDATE OR DELETE ON maintenance."DocumentRagChunk" FOR EACH ROW EXECUTE FUNCTION maintenance.prevent_audit_change();
CREATE FUNCTION maintenance.check_rag_index_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RAG source evidence cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW."orgId",NEW."machineId",NEW."documentId",NEW."fileId",NEW.profile,NEW."sourceHash",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."orgId",OLD."machineId",OLD."documentId",OLD."fileId",OLD.profile,OLD."sourceHash",OLD."createdAt") THEN RAISE EXCEPTION 'RAG source identity is immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM maintenance."MachineDocumentFile" f WHERE f.id=NEW."fileId" AND f.sha256=NEW."sourceHash") THEN RAISE EXCEPTION 'RAG source hash mismatch'; END IF;
 IF TG_OP='UPDATE' AND OLD.status='READY' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Ready RAG indexes are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_rag_index_check BEFORE INSERT OR UPDATE OR DELETE ON maintenance."DocumentRagIndex" FOR EACH ROW EXECUTE FUNCTION maintenance.check_rag_index_change();
CREATE FUNCTION maintenance.check_rag_ready() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='READY' AND (SELECT count(*) FROM maintenance."DocumentRagChunk" c WHERE c."indexId"=NEW.id)<>NEW."chunkCount" THEN RAISE EXCEPTION 'RAG ready index requires complete chunks'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER document_rag_ready_check AFTER INSERT OR UPDATE ON maintenance."DocumentRagIndex" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION maintenance.check_rag_ready();
REVOKE ALL ON maintenance."DocumentRagIndex",maintenance."DocumentRagChunk" FROM PUBLIC;
REVOKE CREATE ON SCHEMA extensions FROM PUBLIC;

CREATE FUNCTION maintenance.check_rag_chunk_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM maintenance."DocumentRagIndex" i WHERE i.id=NEW."indexId" AND i.status='PROCESSING') THEN RAISE EXCEPTION 'Chunks require a claimed index'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_rag_chunk_insert BEFORE INSERT ON maintenance."DocumentRagChunk" FOR EACH ROW EXECUTE FUNCTION maintenance.check_rag_chunk_insert();
