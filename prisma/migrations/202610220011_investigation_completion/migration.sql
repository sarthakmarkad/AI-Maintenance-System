-- Investigations record when the inspection was completed, like planned maintenance; they still carry no breakdown cause or restoration.
ALTER TABLE maintenance."WorkOrder" DROP CONSTRAINT work_order_kind;
ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT work_order_kind CHECK (
  (kind='BREAKDOWN' AND "occurrenceId" IS NULL AND "anomalyReviewId" IS NULL AND "performedAt" IS NULL)
  OR (kind='PLANNED' AND "occurrenceId" IS NOT NULL AND "anomalyReviewId" IS NULL AND impact='OBSERVATION' AND "rootCause" IS NULL AND "restoredAt" IS NULL)
  OR (kind='INVESTIGATION' AND "anomalyReviewId" IS NOT NULL AND "occurrenceId" IS NULL AND impact='OBSERVATION' AND "restoredAt" IS NULL AND "rootCause" IS NULL)
);

ALTER TABLE maintenance."WorkOrder" DROP CONSTRAINT work_order_submission;
ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT work_order_submission CHECK (status NOT IN ('AWAITING_REVIEW','APPROVED','CLOSED') OR ("submittedAt" IS NOT NULL AND "submittedAt" <= "updatedAt" AND findings IS NOT NULL AND length(btrim(findings)) >= 3 AND "correctiveAction" IS NOT NULL AND length(btrim("correctiveAction")) >= 3 AND ((kind='BREAKDOWN' AND "restoredAt" IS NOT NULL AND "restoredAt" <= "submittedAt" AND "rootCause" IS NOT NULL AND length(btrim("rootCause")) >= 3 AND "preventiveAction" IS NOT NULL AND length(btrim("preventiveAction")) >= 3) OR (kind IN ('PLANNED','INVESTIGATION') AND "performedAt" IS NOT NULL AND "performedAt" <= "submittedAt" AND "rootCause" IS NULL AND "restoredAt" IS NULL))));
