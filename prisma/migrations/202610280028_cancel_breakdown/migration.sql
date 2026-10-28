ALTER TABLE maintenance."WorkOrder" DROP CONSTRAINT work_order_assignment;
ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT work_order_assignment CHECK (
 (status = 'REPORTED' AND "technicianId" IS NULL) OR
 (status = 'CANCELLED') OR
 (status NOT IN ('REPORTED','CANCELLED') AND "technicianId" IS NOT NULL)
);
ALTER TABLE maintenance."WorkOrderEvent" DROP CONSTRAINT work_order_event_action;
ALTER TABLE maintenance."WorkOrderEvent" ADD CONSTRAINT work_order_event_action CHECK (
 action IN ('REPORT','SCHEDULE','INVESTIGATE','ASSIGN','START','SUBMIT','APPROVE','RETURN','CLOSE','ATTACH','CANCEL') AND version>0
);
CREATE OR REPLACE FUNCTION maintenance.check_work_order_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.version <> OLD.version+1 OR OLD.status IN ('CLOSED','CANCELLED') THEN RAISE EXCEPTION 'Invalid work order version or terminal state'; END IF;
 IF NEW.status=OLD.status AND OLD.status IN ('REPORTED','IN_PROGRESS') AND
    (to_jsonb(NEW)-'version'-'updatedAt')=(to_jsonb(OLD)-'version'-'updatedAt') THEN RETURN NEW; END IF;
 IF NEW.status='CANCELLED' AND OLD.kind='BREAKDOWN' AND OLD.status IN ('REPORTED','ASSIGNED','IN_PROGRESS','AWAITING_REVIEW') THEN RETURN NEW; END IF;
 IF NOT ((OLD.status='REPORTED' AND NEW.status='ASSIGNED') OR (OLD.status='ASSIGNED' AND NEW.status IN ('ASSIGNED','IN_PROGRESS')) OR (OLD.status='IN_PROGRESS' AND NEW.status IN ('ASSIGNED','AWAITING_REVIEW')) OR (OLD.status='AWAITING_REVIEW' AND NEW.status IN ('IN_PROGRESS','APPROVED')) OR (OLD.status='APPROVED' AND NEW.status='CLOSED')) THEN RAISE EXCEPTION 'Invalid work order state transition'; END IF;
 RETURN NEW;
END $$;
