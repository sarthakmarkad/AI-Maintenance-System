-- AlterTable
ALTER TABLE maintenance."WorkOrder" ADD COLUMN "anomalyReviewId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_anomalyReviewId_key" ON maintenance."WorkOrder"("anomalyReviewId");
CREATE UNIQUE INDEX "WorkOrder_orgId_machineId_anomalyReviewId_key" ON maintenance."WorkOrder"("orgId", "machineId", "anomalyReviewId");
CREATE UNIQUE INDEX "AnomalyReview_orgId_machineId_id_key" ON maintenance."AnomalyReview"("orgId", "machineId", id);

-- AddForeignKey
ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT "WorkOrder_orgId_machineId_anomalyReviewId_fkey" FOREIGN KEY ("orgId", "machineId", "anomalyReviewId") REFERENCES maintenance."AnomalyReview"("orgId", "machineId", id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Kind now requires exactly one of: scheduled occurrence (PLANNED) or flag review (INVESTIGATION).
ALTER TABLE maintenance."WorkOrder" DROP CONSTRAINT work_order_kind;
ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT work_order_kind CHECK (
  (kind='BREAKDOWN' AND "occurrenceId" IS NULL AND "anomalyReviewId" IS NULL AND "performedAt" IS NULL)
  OR (kind='PLANNED' AND "occurrenceId" IS NOT NULL AND "anomalyReviewId" IS NULL AND impact='OBSERVATION' AND "rootCause" IS NULL AND "restoredAt" IS NULL)
  OR (kind='INVESTIGATION' AND "anomalyReviewId" IS NOT NULL AND "occurrenceId" IS NULL AND impact='OBSERVATION' AND "performedAt" IS NULL AND "restoredAt" IS NULL)
);

-- Submission evidence for investigations is a human finding and outcome, without breakdown RCA/restoration.
ALTER TABLE maintenance."WorkOrder" DROP CONSTRAINT work_order_submission;
ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT work_order_submission CHECK (status NOT IN ('AWAITING_REVIEW','APPROVED','CLOSED') OR ("submittedAt" IS NOT NULL AND "submittedAt" <= "updatedAt" AND findings IS NOT NULL AND length(btrim(findings)) >= 3 AND "correctiveAction" IS NOT NULL AND length(btrim("correctiveAction")) >= 3 AND ((kind='BREAKDOWN' AND "restoredAt" IS NOT NULL AND "restoredAt" <= "submittedAt" AND "rootCause" IS NOT NULL AND length(btrim("rootCause")) >= 3 AND "preventiveAction" IS NOT NULL AND length(btrim("preventiveAction")) >= 3) OR (kind='PLANNED' AND "performedAt" IS NOT NULL AND "performedAt" <= "submittedAt") OR (kind='INVESTIGATION' AND "rootCause" IS NULL AND "restoredAt" IS NULL))));

-- Event actions for the investigation lifecycle.
ALTER TABLE maintenance."WorkOrderEvent" DROP CONSTRAINT work_order_event_action;
ALTER TABLE maintenance."WorkOrderEvent" ADD CONSTRAINT work_order_event_action CHECK (action IN ('REPORT','SCHEDULE','INVESTIGATE','ASSIGN','START','SUBMIT','APPROVE','RETURN','CLOSE') AND version > 0);

CREATE FUNCTION maintenance.check_investigation_work_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='INVESTIGATION' THEN
  PERFORM id FROM maintenance."AnomalyReview" WHERE id=NEW."anomalyReviewId" AND "orgId"=NEW."orgId" AND "machineId"=NEW."machineId" AND decision='INVESTIGATE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'An investigate-decision review in this scope is required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER maintenance_investigation_work_insert BEFORE INSERT ON maintenance."WorkOrder" FOR EACH ROW EXECUTE FUNCTION maintenance.check_investigation_work_insert();
