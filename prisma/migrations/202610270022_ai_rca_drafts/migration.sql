-- Private append-only advisory evidence. No work-order updates or browser/Data API grants.
CREATE TABLE maintenance."RcaDraftRequest" (
  id uuid PRIMARY KEY,
  "orgId" uuid NOT NULL,
  "machineId" uuid NOT NULL,
  "orderId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "requestId" uuid NOT NULL,
  fingerprint varchar(64) NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  version integer NOT NULL CHECK (version > 0),
  "sourceHash" varchar(64) NOT NULL CHECK ("sourceHash" ~ '^[a-f0-9]{64}$'),
  model varchar(100) NOT NULL,
  policy varchar(64) NOT NULL CHECK (policy = 'recorded-text-rca-v1'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=96000),
  "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE ("orgId","userId","requestId"),
  FOREIGN KEY ("orgId","machineId","orderId") REFERENCES maintenance."WorkOrder" ("orgId","machineId",id) ON DELETE RESTRICT,
  FOREIGN KEY ("orgId","userId") REFERENCES maintenance."Membership" ("orgId","userId") ON DELETE RESTRICT
);
CREATE INDEX "RcaDraftRequest_history" ON maintenance."RcaDraftRequest" ("orgId","machineId","orderId","createdAt" DESC,id DESC);
CREATE INDEX "RcaDraftRequest_quota" ON maintenance."RcaDraftRequest" ("orgId","userId","createdAt" DESC);
CREATE TABLE maintenance."RcaDraftReceipt" (
  "requestId" uuid PRIMARY KEY REFERENCES maintenance."RcaDraftRequest" (id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL CHECK (status IN ('GENERATED','FAILED','STALE')),
  reason varchar(64),
  draft jsonb CHECK (draft IS NULL OR (jsonb_typeof(draft)='object' AND octet_length(draft::text)<=96000)),
  "completedAt" timestamptz(3) NOT NULL DEFAULT now(),
  CHECK ((status='GENERATED' AND draft IS NOT NULL AND reason IS NULL) OR (status IN ('FAILED','STALE') AND draft IS NULL AND reason IS NOT NULL))
);
CREATE FUNCTION maintenance.rca_draft_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'RCA draft evidence is immutable'; END;
$$;
CREATE TRIGGER "RcaDraftRequest_immutable" BEFORE UPDATE OR DELETE ON maintenance."RcaDraftRequest" FOR EACH ROW EXECUTE FUNCTION maintenance.rca_draft_immutable();
CREATE TRIGGER "RcaDraftReceipt_immutable" BEFORE UPDATE OR DELETE ON maintenance."RcaDraftReceipt" FOR EACH ROW EXECUTE FUNCTION maintenance.rca_draft_immutable();
REVOKE ALL ON maintenance."RcaDraftRequest",maintenance."RcaDraftReceipt" FROM PUBLIC;
REVOKE ALL ON FUNCTION maintenance.rca_draft_immutable() FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON maintenance."RcaDraftRequest",maintenance."RcaDraftReceipt" FROM %I',r);
    END IF;
  END LOOP;
END $$;

-- Defense in depth for narrow runtime INSERT rights; active-role selection is also
-- enforced by the HTTP guard and revalidated application context.
CREATE FUNCTION maintenance.rca_request_eligible() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM maintenance."WorkOrder" w
    JOIN maintenance."Membership" m ON m."orgId"=w."orgId" AND m."userId"=NEW."userId"
    WHERE w.id=NEW."orderId" AND w."orgId"=NEW."orgId" AND w."machineId"=NEW."machineId"
      AND w.kind='BREAKDOWN' AND w.status='IN_PROGRESS' AND w.version=NEW.version
      AND w."technicianId"=NEW."userId" AND m.active
      AND (m.role='TECHNICIAN' OR EXISTS (
        SELECT 1 FROM maintenance."MembershipRoleGrant" g
        WHERE g."orgId"=m."orgId" AND g."membershipId"=m.id AND g.role='TECHNICIAN' AND g.active
      ))
      AND EXISTS (SELECT 1 FROM maintenance."MachineAccess" a WHERE a."orgId"=m."orgId" AND a."membershipId"=m.id AND a."machineId"=w."machineId")
  ) THEN RAISE EXCEPTION 'RCA generation requires current assigned technician and breakdown version'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "RcaDraftRequest_eligible" BEFORE INSERT ON maintenance."RcaDraftRequest" FOR EACH ROW EXECUTE FUNCTION maintenance.rca_request_eligible();
REVOKE ALL ON FUNCTION maintenance.rca_request_eligible() FROM PUBLIC;

-- A runtime INSERT alone cannot retain generation evidence. The protected audit
-- must match the exact scope, actor, reservation and provenance in the same commit.
CREATE FUNCTION maintenance.check_rca_request_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,maintenance AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM maintenance."AuditEvent" a
    WHERE a."orgId"=NEW."orgId" AND a."actorId"=NEW."userId" AND a."entityId"=NEW.id::text
      AND a.action='RCA_DRAFT_REQUESTED'
      AND a.detail->>'orderId'=NEW."orderId"::text
      AND a.detail->>'requestId'=NEW."requestId"::text
      AND a.detail->>'version'=NEW.version::text
      AND a.detail->>'sourceHash'=NEW."sourceHash"
      AND a.detail->>'model'=NEW.model AND a.detail->>'policy'=NEW.policy
      AND a.detail->>'actorRole'='TECHNICIAN' AND a.detail->>'status'='PENDING'
  ) THEN RAISE EXCEPTION 'RCA reservation requires matching protected audit'; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "RcaDraftRequest_audit" AFTER INSERT ON maintenance."RcaDraftRequest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION maintenance.check_rca_request_audit();
CREATE FUNCTION maintenance.check_rca_receipt_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,maintenance AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM maintenance."RcaDraftRequest" r JOIN maintenance."AuditEvent" a
      ON a."orgId"=r."orgId" AND a."actorId"=r."userId" AND a."entityId"=r.id::text
    WHERE r.id=NEW."requestId" AND a.action='RCA_DRAFT_'||NEW.status
      AND a.detail->>'orderId'=r."orderId"::text
      AND a.detail->>'requestId'=r."requestId"::text
      AND a.detail->>'version'=r.version::text
      AND a.detail->>'sourceHash'=r."sourceHash"
      AND a.detail->>'model'=r.model AND a.detail->>'policy'=r.policy
      AND a.detail->>'actorRole'='TECHNICIAN' AND a.detail->>'status'=NEW.status
  ) THEN RAISE EXCEPTION 'RCA receipt requires matching protected audit'; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "RcaDraftReceipt_audit" AFTER INSERT ON maintenance."RcaDraftReceipt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION maintenance.check_rca_receipt_audit();
REVOKE ALL ON FUNCTION maintenance.check_rca_request_audit(), maintenance.check_rca_receipt_audit() FROM PUBLIC;
