-- Plain existence check: FOR SHARE/UPDATE need row-lock privileges the runtime role intentionally lacks.
CREATE OR REPLACE FUNCTION maintenance.check_investigation_work_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='INVESTIGATION' THEN
  IF NOT EXISTS (SELECT 1 FROM maintenance."AnomalyReview" WHERE id=NEW."anomalyReviewId" AND "orgId"=NEW."orgId" AND "machineId"=NEW."machineId" AND decision='INVESTIGATE') THEN RAISE EXCEPTION 'An investigate-decision review in this scope is required'; END IF;
 END IF;
 RETURN NEW;
END $$;
