-- Opt-in email only. No seed/backfill and no changes to workflow events/receipts.
-- Private schema; invoker functions use the same narrow runtime permissions.
CREATE FUNCTION maintenance.external_notification_access(org UUID, machine UUID, recipient UUID, selected maintenance."Role")
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path=pg_catalog,maintenance AS $$
 SELECT selected IN ('TECHNICIAN','MAINTENANCE_HEAD') AND EXISTS (
  SELECT 1 FROM maintenance."Membership" m
  JOIN maintenance."Machine" w ON w."orgId"=m."orgId" AND w.id=machine AND w.code='WH-C'
  WHERE m."orgId"=org AND m."userId"=recipient AND m.active
   AND (m.role=selected OR EXISTS (SELECT 1 FROM maintenance."MembershipRoleGrant" g
    WHERE g."orgId"=org AND g."membershipId"=m.id AND g.role=selected AND g.active))
   AND (selected='MAINTENANCE_HEAD' OR EXISTS (SELECT 1 FROM maintenance."MachineAccess" a
    WHERE a."orgId"=org AND a."machineId"=machine AND a."membershipId"=m.id))
 );
$$;
CREATE FUNCTION maintenance.external_notification_actionable(org UUID, machine UUID, event UUID, recipient UUID, selected maintenance."Role")
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path=pg_catalog,maintenance AS $$
 SELECT maintenance.external_notification_access(org,machine,recipient,selected) AND EXISTS (
  SELECT 1 FROM maintenance."WorkOrderEvent" e JOIN maintenance."WorkOrder" o
   ON o.id=e."orderId" AND o."orgId"=org AND o."machineId"=machine
  WHERE e.id=event AND e."orgId"=org AND e."machineId"=machine
   AND NOT EXISTS(SELECT 1 FROM maintenance."WorkOrderEvent" n
    WHERE n."orderId"=e."orderId" AND n.version>e.version AND n.action<>'ATTACH')
   AND ((selected='MAINTENANCE_HEAD' AND ((e.action='REPORT' AND o.kind='BREAKDOWN' AND o.status='REPORTED') OR
      (e.action='SUBMIT' AND o.status='AWAITING_REVIEW'))) OR
    (selected='TECHNICIAN' AND o."technicianId"=recipient AND
      ((e.action IN ('ASSIGN','SCHEDULE','INVESTIGATE') AND o.status='ASSIGNED') OR (e.action='RETURN' AND o.status='IN_PROGRESS'))))
 );
$$;
CREATE TABLE maintenance."ExternalNotificationPreference" (
 id UUID PRIMARY KEY, "orgId" UUID NOT NULL, "machineId" UUID NOT NULL, "userId" UUID NOT NULL,
 role maintenance."Role" NOT NULL CHECK(role IN ('TECHNICIAN','MAINTENANCE_HEAD')),
 version INTEGER NOT NULL CHECK(version>0), enabled BOOLEAN NOT NULL,
 destination VARCHAR(254), "enabledAt" TIMESTAMPTZ(3), "verifiedAt" TIMESTAMPTZ(3),
 "requestId" UUID NOT NULL, fingerprint VARCHAR(64) NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CHECK((enabled AND destination IS NOT NULL AND "enabledAt" IS NOT NULL AND "verifiedAt" IS NOT NULL) OR
       (NOT enabled AND destination IS NULL AND "enabledAt" IS NULL AND "verifiedAt" IS NULL)),
 CHECK(destination IS NULL OR (destination ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
 UNIQUE("orgId","machineId","userId",role,version),
 UNIQUE("orgId","machineId","userId",role,"requestId"),
 UNIQUE("orgId","machineId","userId",role,id),
 FOREIGN KEY("orgId","machineId") REFERENCES maintenance."Machine"("orgId",id) ON DELETE RESTRICT,
 FOREIGN KEY("orgId","userId") REFERENCES maintenance."Membership"("orgId","userId") ON DELETE RESTRICT
);
CREATE INDEX "ExternalNotificationPreference_latest_idx" ON maintenance."ExternalNotificationPreference"("orgId","machineId","userId",role,version DESC);
CREATE TRIGGER external_preference_immutable BEFORE UPDATE OR DELETE ON maintenance."ExternalNotificationPreference"
 FOR EACH ROW EXECUTE FUNCTION maintenance.prevent_audit_change();
CREATE FUNCTION maintenance.check_external_preference() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,maintenance AS $$
DECLARE prior INTEGER;
BEGIN
 -- Serialize all changes for one actual identity/role without membership UPDATE grants.
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW."orgId"::text||':'||NEW."machineId"::text||':'||NEW."userId"::text||':'||NEW.role::text, 270021));
 SELECT coalesce(max(version),0) INTO prior FROM maintenance."ExternalNotificationPreference"
  WHERE "orgId"=NEW."orgId" AND "machineId"=NEW."machineId" AND "userId"=NEW."userId" AND role=NEW.role;
 IF NEW.version<>prior+1 OR NOT maintenance.external_notification_access(NEW."orgId",NEW."machineId",NEW."userId",NEW.role)
 THEN RAISE EXCEPTION 'Preference version or trusted access changed'; END IF;
 -- Times originate in PostgreSQL, never in browser metadata.
 NEW."createdAt":=clock_timestamp();
 IF NEW.enabled THEN NEW."enabledAt":=NEW."createdAt"; NEW."verifiedAt":=NEW."createdAt"; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER external_preference_insert BEFORE INSERT ON maintenance."ExternalNotificationPreference"
 FOR EACH ROW EXECUTE FUNCTION maintenance.check_external_preference();
CREATE TABLE maintenance."ExternalNotificationOutbox" (
 id UUID PRIMARY KEY, "orgId" UUID NOT NULL, "machineId" UUID NOT NULL, "userId" UUID NOT NULL,
 role maintenance."Role" NOT NULL CHECK(role IN ('TECHNICIAN','MAINTENANCE_HEAD')),
 "preferenceId" UUID NOT NULL, "eventId" UUID NOT NULL,
 destination VARCHAR(254) NOT NULL, payload JSONB NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','SENT','FAILED','SUPPRESSED')),
 "attemptCount" INTEGER NOT NULL DEFAULT 0 CHECK("attemptCount" BETWEEN 0 AND 6),
 "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "firstAttemptAt" TIMESTAMPTZ(3), "leaseToken" UUID, "leaseUntil" TIMESTAMPTZ(3),
 "providerId" VARCHAR(100), code VARCHAR(40),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CHECK((status='SENDING' AND "leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL) OR
       (status<>'SENDING' AND "leaseToken" IS NULL AND "leaseUntil" IS NULL)),
 CHECK(("attemptCount"=0 AND "firstAttemptAt" IS NULL) OR ("attemptCount">0 AND "firstAttemptAt" IS NOT NULL)),
 CHECK((status='SENT' AND "providerId" IS NOT NULL) OR (status<>'SENT' AND "providerId" IS NULL)),
 CHECK(code IS NULL OR code IN ('CLAIMED','ACCEPTED','RATE_LIMITED','PROVIDER_BUSY','PROVIDER_UNAVAILABLE','PROVIDER_REJECTED',
  'IDEMPOTENCY_CONFLICT','INVALID_PROVIDER_RESPONSE','NETWORK_UNCERTAIN','LEASE_EXPIRED','STALE_OR_DISABLED','NOT_CONFIGURED','ATTEMPTS_EXHAUSTED','IDEMPOTENCY_WINDOW_EXPIRED')),
 CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=4096
  AND payload ?& ARRAY['from','to','subject','text'] AND payload-'from'-'to'-'subject'-'text'='{}'::jsonb
  AND payload->>'subject'='WH-C work-order action' AND payload->'to'=jsonb_build_array(destination)
  AND jsonb_typeof(payload->'text')='string' AND jsonb_typeof(payload->'subject')='string' AND jsonb_typeof(payload->'from')='string'),
 UNIQUE("orgId","machineId","userId",role,"eventId","preferenceId"),
 FOREIGN KEY("orgId","machineId","userId",role,"preferenceId") REFERENCES maintenance."ExternalNotificationPreference"("orgId","machineId","userId",role,id) ON DELETE RESTRICT,
 FOREIGN KEY("orgId","machineId","eventId") REFERENCES maintenance."WorkOrderEvent"("orgId","machineId",id) ON DELETE RESTRICT
);
CREATE INDEX "ExternalNotificationOutbox_due_idx" ON maintenance."ExternalNotificationOutbox"("nextAttemptAt",id) WHERE status='PENDING';
CREATE INDEX "ExternalNotificationOutbox_lease_idx" ON maintenance."ExternalNotificationOutbox"("leaseUntil",id) WHERE status='SENDING';
CREATE INDEX "ExternalNotificationOutbox_owner_idx" ON maintenance."ExternalNotificationOutbox"("orgId","machineId","userId",role,"createdAt" DESC,id);
CREATE INDEX "ExternalNotificationOutbox_event_idx" ON maintenance."ExternalNotificationOutbox"("orgId","machineId","eventId");
CREATE INDEX "ExternalNotificationOutbox_preference_idx" ON maintenance."ExternalNotificationOutbox"("orgId","machineId","userId",role,"preferenceId");
CREATE TABLE maintenance."ExternalNotificationAttempt" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "outboxId" UUID NOT NULL REFERENCES maintenance."ExternalNotificationOutbox"(id) ON DELETE RESTRICT,
 attempt INTEGER NOT NULL CHECK(attempt BETWEEN 0 AND 6), status VARCHAR(16) NOT NULL,
 code VARCHAR(40), "providerId" VARCHAR(100), "leaseToken" UUID, late BOOLEAN NOT NULL DEFAULT false, at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX "ExternalNotificationAttempt_result_key" ON maintenance."ExternalNotificationAttempt"("outboxId",attempt,status,"leaseToken") WHERE late;
CREATE INDEX "ExternalNotificationAttempt_outbox_idx" ON maintenance."ExternalNotificationAttempt"("outboxId",at,id);
CREATE TRIGGER external_attempt_immutable BEFORE UPDATE OR DELETE ON maintenance."ExternalNotificationAttempt"
 FOR EACH ROW EXECUTE FUNCTION maintenance.prevent_audit_change();
CREATE FUNCTION maintenance.external_notification_current(queue UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path=pg_catalog,maintenance AS $$
 SELECT EXISTS(SELECT 1 FROM maintenance."ExternalNotificationOutbox" q
  JOIN maintenance."ExternalNotificationPreference" p ON p.id=q."preferenceId"
  JOIN maintenance."WorkOrderEvent" e ON e.id=q."eventId"
  WHERE q.id=queue AND p.enabled AND p.destination=q.destination AND e.at>p."enabledAt"
   AND NOT EXISTS(SELECT 1 FROM maintenance."ExternalNotificationPreference" n WHERE n."orgId"=p."orgId"
    AND n."machineId"=p."machineId" AND n."userId"=p."userId" AND n.role=p.role AND n.version>p.version)
   AND maintenance.external_notification_actionable(q."orgId",q."machineId",q."eventId",q."userId",q.role));
$$;
CREATE FUNCTION maintenance.check_external_outbox() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,maintenance AS $$
DECLARE p maintenance."ExternalNotificationPreference"; e maintenance."WorkOrderEvent";
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Outbox evidence cannot be deleted'; END IF;
 IF TG_OP='INSERT' THEN
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
CREATE TRIGGER external_outbox_change BEFORE INSERT OR UPDATE OR DELETE ON maintenance."ExternalNotificationOutbox"
 FOR EACH ROW EXECUTE FUNCTION maintenance.check_external_outbox();
-- Triggers append audit and attempt evidence atomically; a failed audit rolls back
-- the preference/enqueue/claim/result, with no provider call inside a transaction.
CREATE FUNCTION maintenance.audit_external_notification() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,maintenance AS $$
BEGIN
 IF TG_TABLE_NAME='ExternalNotificationPreference' THEN
  INSERT INTO maintenance."AuditEvent"(id,"orgId","actorId",action,"entityId",detail)
   VALUES(gen_random_uuid(),NEW."orgId",NEW."userId",'EXTERNAL_NOTIFICATION_PREFERENCE',NEW.id::text,
    jsonb_build_object('actorRole',NEW.role,'machineId',NEW."machineId",'version',NEW.version,'enabled',NEW.enabled));
 ELSE
  INSERT INTO maintenance."ExternalNotificationAttempt"("outboxId",attempt,status,code,"providerId","leaseToken")
   VALUES(NEW.id,NEW."attemptCount",NEW.status,NEW.code,NEW."providerId",NEW."leaseToken");
  INSERT INTO maintenance."AuditEvent"(id,"orgId",action,"entityId",detail)
   VALUES(gen_random_uuid(),NEW."orgId",'EXTERNAL_NOTIFICATION_DELIVERY',NEW.id::text,
    jsonb_build_object('origin','EMAIL_WORKER','recipientId',NEW."userId",'recipientRole',NEW.role,'machineId',NEW."machineId",
     'eventId',NEW."eventId",'preferenceId',NEW."preferenceId",'attempt',NEW."attemptCount",'status',NEW.status,'code',NEW.code));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER external_preference_audit AFTER INSERT ON maintenance."ExternalNotificationPreference" FOR EACH ROW EXECUTE FUNCTION maintenance.audit_external_notification();
CREATE TRIGGER external_outbox_audit AFTER INSERT OR UPDATE ON maintenance."ExternalNotificationOutbox" FOR EACH ROW EXECUTE FUNCTION maintenance.audit_external_notification();
REVOKE ALL ON maintenance."ExternalNotificationPreference",maintenance."ExternalNotificationOutbox",maintenance."ExternalNotificationAttempt" FROM PUBLIC;
REVOKE ALL ON FUNCTION maintenance.external_notification_access(UUID,UUID,UUID,maintenance."Role"),
 maintenance.external_notification_actionable(UUID,UUID,UUID,UUID,maintenance."Role"),maintenance.external_notification_current(UUID),
 maintenance.check_external_preference(),maintenance.check_external_outbox(),maintenance.audit_external_notification() FROM PUBLIC;
-- Parent applies grants only after isolated migration rehearsal. No browser/Data API grants.

-- Normal attempt records can only originate inside the outbox audit trigger.
-- A late HTTP result may be appended by the worker only for an existing claim.
CREATE FUNCTION maintenance.check_external_attempt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,maintenance AS $$
BEGIN
 IF NOT NEW.late THEN
  IF pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Attempt evidence must accompany an outbox transition'; END IF;
 ELSE
  IF NEW.status NOT IN ('SENT','PENDING','FAILED') OR NEW.code NOT IN ('ACCEPTED','RATE_LIMITED','PROVIDER_BUSY','PROVIDER_UNAVAILABLE','PROVIDER_REJECTED',
   'IDEMPOTENCY_CONFLICT','INVALID_PROVIDER_RESPONSE','NETWORK_UNCERTAIN','ATTEMPTS_EXHAUSTED','IDEMPOTENCY_WINDOW_EXPIRED','NOT_CONFIGURED') OR
   (NEW.status='SENT') IS DISTINCT FROM (NEW."providerId" IS NOT NULL) OR
   NOT EXISTS(SELECT 1 FROM maintenance."ExternalNotificationAttempt" a WHERE a."outboxId"=NEW."outboxId" AND a.attempt=NEW.attempt
    AND a.status='SENDING' AND a.code='CLAIMED' AND a."leaseToken"=NEW."leaseToken" AND NOT a.late)
  THEN RAISE EXCEPTION 'Late result requires the original immutable claim'; END IF;
 END IF;
 NEW.at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER external_attempt_insert BEFORE INSERT ON maintenance."ExternalNotificationAttempt" FOR EACH ROW EXECUTE FUNCTION maintenance.check_external_attempt();
CREATE FUNCTION maintenance.audit_external_late_result() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,maintenance AS $$
DECLARE q maintenance."ExternalNotificationOutbox";
BEGIN
 IF NEW.late THEN
  SELECT * INTO q FROM maintenance."ExternalNotificationOutbox" WHERE id=NEW."outboxId";
  INSERT INTO maintenance."AuditEvent"(id,"orgId",action,"entityId",detail)
   VALUES(gen_random_uuid(),q."orgId",'EXTERNAL_NOTIFICATION_LATE_RESULT',NEW.id::text,
    jsonb_build_object('origin','EMAIL_WORKER','outboxId',q.id,'attempt',NEW.attempt,'status',NEW.status,'code',NEW.code));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER external_late_result_audit AFTER INSERT ON maintenance."ExternalNotificationAttempt" FOR EACH ROW EXECUTE FUNCTION maintenance.audit_external_late_result();
REVOKE ALL ON FUNCTION maintenance.check_external_attempt(),maintenance.audit_external_late_result() FROM PUBLIC;
