-- Text-only retrieval stores no invented embedding. Existing vectors remain unchanged.
ALTER TABLE maintenance."DocumentRagChunk" ALTER COLUMN embedding DROP NOT NULL;
ALTER TABLE maintenance."DocumentRagChunk" ADD COLUMN "searchEnglish" tsvector
 GENERATED ALWAYS AS (to_tsvector('english',text)) STORED;
CREATE INDEX "DocumentRagChunk_english_search_idx" ON maintenance."DocumentRagChunk" USING GIN("searchEnglish");

-- Keep legacy vector requirements while allowing NULL only in the explicit keyword profile.
CREATE OR REPLACE FUNCTION maintenance.check_rag_chunk_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=maintenance,pg_temp AS $$
DECLARE index_profile text;
BEGIN
 SELECT i.profile INTO index_profile FROM maintenance."DocumentRagIndex" i
 WHERE i.id=NEW."indexId" AND i."orgId"=NEW."orgId" AND i."machineId"=NEW."machineId"
 AND i."documentId"=NEW."documentId" AND i."fileId"=NEW."fileId" AND i.status='PROCESSING';
 IF NOT FOUND THEN RAISE EXCEPTION 'Chunks require a claimed scoped index'; END IF;
 IF index_profile='keyword:english-simple-v1:poppler-v1:page-chunks-v1' THEN
  IF NEW.embedding IS NOT NULL THEN RAISE EXCEPTION 'Keyword chunks must not contain embeddings'; END IF;
 ELSE
  IF NEW.embedding IS NULL THEN RAISE EXCEPTION 'Vector chunks require embeddings'; END IF;
 END IF;
 RETURN NEW;
END $$;
