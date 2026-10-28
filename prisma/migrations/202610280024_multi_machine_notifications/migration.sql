-- Keep event/action/identity checks; expand only their machine registry scope.
CREATE OR REPLACE FUNCTION maintenance.check_work_order_notification_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o maintenance."WorkOrder"; e maintenance."WorkOrderEvent";
BEGIN
 SELECT * INTO e FROM maintenance."WorkOrderEvent" WHERE id=NEW."eventId" AND "orgId"=NEW."orgId" AND "machineId"=NEW."machineId";
 IF NOT FOUND THEN RAISE EXCEPTION 'Notification event unavailable'; END IF;
 SELECT * INTO o FROM maintenance."WorkOrder" WHERE id=e."orderId" FOR SHARE;
 IF NOT EXISTS (
   SELECT 1 FROM maintenance."Membership" m WHERE m."userId"=NEW."userId" AND m."orgId"=NEW."orgId" AND m.active
   AND (m.role=NEW.role OR EXISTS (SELECT 1 FROM maintenance."MembershipRoleGrant" g WHERE g."membershipId"=m.id AND g."orgId"=m."orgId" AND g.role=NEW.role AND g.active))
   AND (NEW.role='MAINTENANCE_HEAD' OR EXISTS (SELECT 1 FROM maintenance."MachineAccess" a WHERE a."membershipId"=m.id AND a."orgId"=m."orgId" AND a."machineId"=NEW."machineId"))
 ) OR NOT EXISTS (SELECT 1 FROM maintenance."Machine" WHERE id=NEW."machineId" AND "orgId"=NEW."orgId")
 OR EXISTS (SELECT 1 FROM maintenance."WorkOrderEvent" newer WHERE newer."orderId"=e."orderId" AND newer.version>e.version AND newer.action<>'ATTACH')
 OR NOT (
   (NEW.role='MAINTENANCE_HEAD' AND (
     (e.action='REPORT' AND o.kind='BREAKDOWN' AND o.status='REPORTED') OR
     (e.action='SUBMIT' AND o.status='AWAITING_REVIEW')
   )) OR
   (NEW.role='TECHNICIAN' AND o."technicianId"=NEW."userId" AND (
     (e.action IN ('ASSIGN','SCHEDULE','INVESTIGATE') AND o.status='ASSIGNED') OR
     (e.action='RETURN' AND o.status='IN_PROGRESS')
   ))
 ) THEN RAISE EXCEPTION 'Notification is not actionable for this recipient'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION maintenance.external_notification_access(org UUID, machine UUID, recipient UUID, selected maintenance."Role")
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path=pg_catalog,maintenance AS $$
 SELECT selected IN ('TECHNICIAN','MAINTENANCE_HEAD') AND EXISTS (
  SELECT 1 FROM maintenance."Membership" m
  JOIN maintenance."Machine" w ON w."orgId"=m."orgId" AND w.id=machine
  WHERE m."orgId"=org AND m."userId"=recipient AND m.active
   AND (m.role=selected OR EXISTS (SELECT 1 FROM maintenance."MembershipRoleGrant" g
    WHERE g."orgId"=org AND g."membershipId"=m.id AND g.role=selected AND g.active))
   AND (selected='MAINTENANCE_HEAD' OR EXISTS (SELECT 1 FROM maintenance."MachineAccess" a
    WHERE a."orgId"=org AND a."machineId"=machine AND a."membershipId"=m.id))
 );
$$;

-- Replace the original fixed-subject shape constraint, retaining every existing payload.
DO $$ DECLARE c RECORD; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='maintenance."ExternalNotificationOutbox"'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%WH-C work-order action%' LOOP
  EXECUTE format('ALTER TABLE maintenance."ExternalNotificationOutbox" DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE maintenance."ExternalNotificationOutbox" ADD CONSTRAINT external_email_payload_shape CHECK(
 jsonb_typeof(payload)='object' AND octet_length(payload::text)<=4096
 AND payload ?& ARRAY['from','to','subject','text'] AND payload-'from'-'to'-'subject'-'text'='{}'::jsonb
 AND payload->>'subject' ~ '^[A-Z0-9][A-Z0-9-]{0,31} work-order action$' AND payload->'to'=jsonb_build_array(destination)
 AND jsonb_typeof(payload->'text')='string' AND jsonb_typeof(payload->'subject')='string' AND jsonb_typeof(payload->'from')='string');

CREATE OR REPLACE FUNCTION maintenance.check_external_outbox() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,maintenance AS $$
DECLARE p maintenance."ExternalNotificationPreference"; e maintenance."WorkOrderEvent";
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Outbox evidence cannot be deleted'; END IF;
 IF TG_OP='INSERT' THEN
  IF (NEW.payload->>'subject') IS DISTINCT FROM (SELECT code||' work-order action' FROM maintenance."Machine" WHERE id=NEW."machineId" AND "orgId"=NEW."orgId") THEN RAISE EXCEPTION 'Email payload machine mismatch'; END IF;
  SELECT * INTO p FROM maintenance."ExternalNotificationPreference" WHERE id=NEW."preferenceId";
  SELECT * INTO e FROM maintenance."WorkOrderEvent" WHERE id=NEW."eventId";
  IF NOT p.enabled OR NEW.destination IS DISTINCT FROM p.destination OR e.at<=p."enabledAt" OR
   EXISTS(SELECT 1 FROM maintenance."ExternalNotificationPreference" n WHERE n."orgId"=p."orgId" AND n."machineId"=p."machineId"
     AND n."userId"=p."userId" AND n.role=p.role AND n.version>p.version) OR
   NOT maintenance.external_notification_actionable(NEW."orgId",NEW."machineId",NEW."eventId",NEW."userId",NEW.role) OR
   NEW.status<>'PENDING' OR NEW."attemptCount"<>0 OR NEW.code IS NOT NULL OR NEW."firstAttemptAt" IS NOT NULL
  THEN RAISE EXCEPTION 'Outbox requires a current opt-in and actionable later event'; END IF;
  NEW."createdAt":=clock_timestamp(); NEW."updatedAt":=NEW."createdAt"; NEW."nextAttemptAt":=NEW."createdAt";
 ELSE
  IF (NEW.id,NEW."orgId",NEW."machineId",NEW."userId",NEW.role,NEW."preferenceId",NEW."eventId",NEW.destination,NEW.payload,NEW."createdAt") IS DISTINCT FROM
     (OLD.id,OLD."orgId",OLD."machineId",OLD."userId",OLD.role,OLD."preferenceId",OLD."eventId",OLD.destination,OLD.payload,OLD."createdAt") OR
     OLD.status IN ('SENT','FAILED','SUPPRESSED') THEN RAISE EXCEPTION 'Outbox identity, payload and terminal evidence are immutable'; END IF;
  IF NEW.status='SENDING' THEN
   IF OLD.status<>'PENDING' OR NEW."attemptCount"<>OLD."attemptCount"+1 OR NEW.code IS DISTINCT FROM 'CLAIMED' OR
    NEW."leaseUntil">clock_timestamp()+interval '100 seconds' OR NEW."leaseUntil"<=clock_timestamp() OR
    NOT maintenance.external_notification_current(NEW.id) OR
    (OLD."firstAttemptAt" IS NOT NULL AND OLD."firstAttemptAt" < clock_timestamp()-interval '20 hours')
   THEN RAISE EXCEPTION 'Invalid outbox claim'; END IF;
   NEW."firstAttemptAt":=coalesce(OLD."firstAttemptAt",clock_timestamp());
  ELSIF NEW."attemptCount"<>OLD."attemptCount" OR NEW."firstAttemptAt" IS DISTINCT FROM OLD."firstAttemptAt" OR
    (OLD.status='PENDING' AND NEW.status NOT IN ('FAILED','SUPPRESSED')) OR
    (OLD.status='SENDING' AND NEW.status NOT IN ('PENDING','SENT','FAILED','SUPPRESSED'))
   THEN RAISE EXCEPTION 'Invalid outbox transition'; END IF;
  NEW."updatedAt":=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;

CREATE UNIQUE INDEX machine_access_request_receipt ON maintenance."AuditEvent" ("orgId","entityId",(detail->>'requestId')) WHERE action='MACHINE_ACCESS_UPDATE';
