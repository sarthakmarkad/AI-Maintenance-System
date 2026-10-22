-- Preserve earlier submissions without inventing retrospective outcomes.
CREATE TYPE maintenance."InvestigationOutcome" AS ENUM ('MAINTENANCE_REQUIRED','SENSOR_CHECK_REQUIRED','OPERATING_CHANGE_EXPLAINED','NO_FAULT_FOUND','INCONCLUSIVE');
ALTER TABLE maintenance."WorkOrder" ADD COLUMN "investigationOutcome" maintenance."InvestigationOutcome";
ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT investigation_outcome_kind CHECK (kind='INVESTIGATION' OR "investigationOutcome" IS NULL);
ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT investigation_follow_up CHECK (
  "investigationOutcome" IS NULL OR "investigationOutcome" NOT IN ('MAINTENANCE_REQUIRED','SENSOR_CHECK_REQUIRED')
  OR ("preventiveAction" IS NOT NULL AND length(btrim("preventiveAction")) >= 3)
);
CREATE FUNCTION maintenance.check_investigation_submission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='INVESTIGATION' AND NEW.status='AWAITING_REVIEW' AND (TG_OP='INSERT' OR OLD.status='IN_PROGRESS') AND NEW."investigationOutcome" IS NULL THEN
   RAISE EXCEPTION 'Investigation submission requires an outcome';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER investigation_submission BEFORE INSERT OR UPDATE ON maintenance."WorkOrder" FOR EACH ROW EXECUTE FUNCTION maintenance.check_investigation_submission();
