CREATE TYPE maintenance."AnomalyDecision" AS ENUM ('INVESTIGATE', 'DISMISSED');
CREATE TABLE maintenance."AnomalyReview" (
  id UUID NOT NULL PRIMARY KEY,
  "orgId" UUID NOT NULL,
  "machineId" UUID NOT NULL,
  key VARCHAR(64) NOT NULL,
  "policyVersion" VARCHAR(64) NOT NULL,
  "measuredAt" TIMESTAMPTZ(3) NOT NULL,
  decision maintenance."AnomalyDecision" NOT NULL,
  reason VARCHAR(2000) NOT NULL,
  "reviewedBy" UUID NOT NULL,
  "actorRole" maintenance."Role" NOT NULL,
  evidence JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnomalyReview_orgId_machineId_fkey" FOREIGN KEY ("orgId", "machineId") REFERENCES maintenance."Machine"("orgId", id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AnomalyReview_orgId_reviewedBy_fkey" FOREIGN KEY ("orgId", "reviewedBy") REFERENCES maintenance."Membership"("orgId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "anomaly_review_head" CHECK ("actorRole" = 'MAINTENANCE_HEAD'),
  CONSTRAINT "anomaly_review_key" CHECK (key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "anomaly_review_reason" CHECK (length(trim(reason)) BETWEEN 3 AND 2000),
  CONSTRAINT "anomaly_review_evidence" CHECK (jsonb_typeof(evidence) = 'object' AND evidence->>'key' = key AND evidence->>'policyVersion' = "policyVersion"),
  CONSTRAINT "anomaly_review_time" CHECK ("createdAt" >= "measuredAt")
);
CREATE UNIQUE INDEX "AnomalyReview_orgId_machineId_key_key" ON maintenance."AnomalyReview"("orgId", "machineId", key);
CREATE INDEX "AnomalyReview_orgId_machineId_createdAt_id_idx" ON maintenance."AnomalyReview"("orgId", "machineId", "createdAt", id);
CREATE FUNCTION maintenance.anomaly_review_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Anomaly reviews are immutable'; END $$;
CREATE TRIGGER anomaly_review_immutable BEFORE UPDATE OR DELETE ON maintenance."AnomalyReview" FOR EACH ROW EXECUTE FUNCTION maintenance.anomaly_review_immutable();
REVOKE ALL ON maintenance."AnomalyReview" FROM PUBLIC;
