ALTER TABLE maintenance."Membership" ADD COLUMN "teamVersion" integer NOT NULL DEFAULT 1,
 ADD COLUMN "staffEmail" varchar(254);
ALTER TABLE maintenance."Membership" ADD CONSTRAINT member_team_version CHECK ("teamVersion">0),
 ADD CONSTRAINT member_staff_email CHECK ("staffEmail" IS NULL OR ("staffEmail"=lower(btrim("staffEmail")) AND "staffEmail" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'));
CREATE UNIQUE INDEX member_staff_email_unique ON maintenance."Membership"("orgId","staffEmail") WHERE "staffEmail" IS NOT NULL;
CREATE TABLE maintenance."TeamInvitation" (
 id uuid PRIMARY KEY,"orgId" uuid NOT NULL,"requestId" uuid NOT NULL,"createdBy" uuid NOT NULL,
 email varchar(254) NOT NULL,"displayName" varchar(120) NOT NULL,role maintenance."Role" NOT NULL,
 "machineIds" uuid[] NOT NULL,"tokenHash" varchar(64) NOT NULL,
 status varchar(16) NOT NULL DEFAULT 'PENDING',version integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT now(),"expiresAt" timestamptz(3) NOT NULL,
 "acceptedAt" timestamptz(3),"acceptedBy" uuid,"revokedAt" timestamptz(3),
 UNIQUE("orgId",id),UNIQUE("orgId","createdBy","requestId"),
 FOREIGN KEY("orgId","createdBy") REFERENCES maintenance."Membership"("orgId","userId") ON DELETE RESTRICT,
 FOREIGN KEY("orgId","acceptedBy") REFERENCES maintenance."Membership"("orgId","userId") ON DELETE RESTRICT,
 CHECK(email=lower(btrim(email)) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
 CHECK(length(btrim("displayName")) BETWEEN 2 AND 120 AND "tokenHash" ~ '^[a-f0-9]{64}$' AND version>0),
 CHECK(array_position("machineIds",NULL) IS NULL AND cardinality("machineIds")<=100),
 CHECK("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '7 days'),
 CHECK((status='PENDING' AND "acceptedAt" IS NULL AND "acceptedBy" IS NULL AND "revokedAt" IS NULL) OR
 (status='ACCEPTED' AND "acceptedAt" IS NOT NULL AND "acceptedBy" IS NOT NULL AND "revokedAt" IS NULL) OR
 (status IN ('REVOKED','EXPIRED') AND "acceptedAt" IS NULL AND "acceptedBy" IS NULL AND "revokedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX team_pending_email ON maintenance."TeamInvitation"("orgId",email) WHERE status='PENDING';
CREATE INDEX "TeamInvitation_orgId_status_createdAt_idx" ON maintenance."TeamInvitation"("orgId",status,"createdAt");
CREATE INDEX "TeamInvitation_email_status_idx" ON maintenance."TeamInvitation"(email,status);
CREATE INDEX "TeamInvitation_orgId_createdBy_idx" ON maintenance."TeamInvitation"("orgId","createdBy");
CREATE INDEX "TeamInvitation_orgId_acceptedBy_idx" ON maintenance."TeamInvitation"("orgId","acceptedBy");
CREATE TABLE maintenance."TeamAction" (
 id uuid PRIMARY KEY,"orgId" uuid NOT NULL,"actorId" uuid NOT NULL,"requestId" uuid NOT NULL,
 action varchar(40) NOT NULL,"targetId" uuid NOT NULL,fingerprint varchar(64) NOT NULL,result jsonb NOT NULL,
 at timestamptz(3) NOT NULL DEFAULT now(),UNIQUE("orgId","actorId","requestId"),
 FOREIGN KEY("orgId","actorId") REFERENCES maintenance."Membership"("orgId","userId") ON DELETE RESTRICT,
 CHECK(fingerprint ~ '^[a-f0-9]{64}$')
);
CREATE INDEX "TeamAction_orgId_targetId_at_idx" ON maintenance."TeamAction"("orgId","targetId",at);
CREATE TABLE maintenance."TeamInvitationEmail" (
 id uuid PRIMARY KEY,"orgId" uuid NOT NULL,"invitationId" uuid NOT NULL,"actorId" uuid NOT NULL,"requestId" uuid NOT NULL,
 status varchar(16) NOT NULL DEFAULT 'PENDING',code varchar(80),"providerId" varchar(100),
 "leaseUntil" timestamptz(3) NOT NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT now(),"finishedAt" timestamptz(3),
 UNIQUE("orgId","actorId","requestId"),
 FOREIGN KEY("orgId","invitationId") REFERENCES maintenance."TeamInvitation"("orgId",id) ON DELETE RESTRICT,
 FOREIGN KEY("orgId","actorId") REFERENCES maintenance."Membership"("orgId","userId") ON DELETE RESTRICT,
 CHECK((status='PENDING' AND "finishedAt" IS NULL AND code IS NULL AND "providerId" IS NULL) OR
 (status='SENT' AND "finishedAt" IS NOT NULL AND "providerId" IS NOT NULL AND code IS NULL) OR
 (status IN ('FAILED','UNCERTAIN') AND "finishedAt" IS NOT NULL AND code IS NOT NULL AND "providerId" IS NULL))
);
CREATE INDEX "TeamInvitationEmail_orgId_invitationId_createdAt_idx" ON maintenance."TeamInvitationEmail"("orgId","invitationId","createdAt");
CREATE INDEX "TeamInvitationEmail_orgId_actorId_idx" ON maintenance."TeamInvitationEmail"("orgId","actorId");

-- Runtime retains no direct INSERT/UPDATE/DELETE on identity, role or team tables.
-- These private, fixed-search-path functions are the explicit authority boundary:
-- Nest verifies Supabase identity first; each call rechecks stored Administrator authority.
-- Organization and machine locks serialize last-admin/access edits with other administration.
CREATE FUNCTION maintenance.team_admin_action(p_org uuid,p_actor uuid,p_request uuid,p_action text,p_target uuid,p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior maintenance."TeamAction"; inv maintenance."TeamInvitation"; member maintenance."Membership";
 delivery maintenance."TeamInvitationEmail"; result jsonb; fingerprint text; machines uuid[]; current_machines uuid[];
 actor_member uuid; role_value maintenance."Role"; is_active boolean; moment timestamptz:=clock_timestamp();
BEGIN
 PERFORM 1 FROM maintenance."Organization" WHERE id=p_org FOR UPDATE;
 SELECT id INTO actor_member FROM maintenance."Membership" m WHERE m."orgId"=p_org AND m."userId"=p_actor AND m.active AND
  (m.role='ADMINISTRATOR' OR EXISTS(SELECT 1 FROM maintenance."MembershipRoleGrant" g WHERE g."membershipId"=m.id AND g."orgId"=p_org AND g.role='ADMINISTRATOR' AND g.active));
 IF actor_member IS NULL THEN RAISE EXCEPTION 'TEAM_FORBIDDEN'; END IF;
 fingerprint:=encode(sha256(convert_to(p_action||':'||p_target::text||':'||p::text,'UTF8')),'hex');
 SELECT * INTO prior FROM maintenance."TeamAction" WHERE "orgId"=p_org AND "actorId"=p_actor AND "requestId"=p_request;
 IF FOUND THEN
  IF prior.fingerprint<>fingerprint THEN RAISE EXCEPTION 'TEAM_CONFLICT'; END IF;
  RETURN prior.result||jsonb_build_object('alreadyApplied',true);
 END IF;
 IF p_action='INVITE' THEN
  IF EXISTS(SELECT 1 FROM maintenance."Membership" WHERE "orgId"=p_org AND "staffEmail"=p->>'email') THEN RAISE EXCEPTION 'TEAM_EXISTS'; END IF;
  machines:=ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p->'machineIds'));
  role_value:=(p->>'role')::maintenance."Role";
  IF role_value IN ('OPERATOR','TECHNICIAN') AND cardinality(machines)=0 THEN RAISE EXCEPTION 'TEAM_MACHINES'; END IF;
  PERFORM 1 FROM maintenance."Machine" WHERE "orgId"=p_org AND id=ANY(machines) ORDER BY id FOR SHARE;
  IF cardinality(machines)<>(SELECT count(DISTINCT id) FROM maintenance."Machine" WHERE "orgId"=p_org AND id=ANY(machines) AND "archivedAt" IS NULL) THEN RAISE EXCEPTION 'TEAM_MACHINES'; END IF;
  IF EXISTS(SELECT 1 FROM maintenance."TeamInvitation" WHERE "orgId"=p_org AND email=p->>'email' AND status='PENDING' AND "expiresAt">moment) THEN RAISE EXCEPTION 'TEAM_EXISTS'; END IF;
  WITH expired AS (UPDATE maintenance."TeamInvitation" SET status='EXPIRED',"revokedAt"=moment,version=version+1 WHERE "orgId"=p_org AND email=p->>'email' AND status='PENDING' AND "expiresAt"<=moment RETURNING id)
  INSERT INTO maintenance."AuditEvent"(id,"orgId","actorId",action,"entityId",detail,at) SELECT gen_random_uuid(),p_org,p_actor,'TEAM_INVITATION_EXPIRED',id::text,jsonb_build_object('actorRole','ADMINISTRATOR'),moment FROM expired;
  INSERT INTO maintenance."TeamInvitation"(id,"orgId","requestId","createdBy",email,"displayName",role,"machineIds","tokenHash","createdAt","expiresAt") VALUES
   (p_target,p_org,p_request,p_actor,p->>'email',p->>'displayName',role_value,machines,p->>'tokenHash',moment,moment+interval '7 days');
  result:=jsonb_build_object('id',p_target,'version',1,'alreadyApplied',false);
 ELSIF p_action='REVOKE_INVITATION' THEN
  SELECT * INTO inv FROM maintenance."TeamInvitation" WHERE id=p_target AND "orgId"=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_NOT_FOUND'; END IF;
  IF inv.version<>(p->>'version')::int OR inv.status<>'PENDING' THEN RAISE EXCEPTION 'TEAM_CONFLICT'; END IF;
  UPDATE maintenance."TeamInvitation" SET status='REVOKED',"revokedAt"=moment,version=version+1 WHERE id=inv.id;
  result:=jsonb_build_object('id',inv.id,'version',inv.version+1,'alreadyApplied',false);
 ELSIF p_action='UPDATE_MEMBER' THEN
  -- Lock machines before memberships, consistently with machine-access administration.
  PERFORM 1 FROM maintenance."Machine" WHERE "orgId"=p_org ORDER BY id FOR UPDATE;
  SELECT * INTO member FROM maintenance."Membership" WHERE id=p_target AND "orgId"=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_NOT_FOUND'; END IF;
  IF member."userId"=p_actor THEN RAISE EXCEPTION 'TEAM_SELF'; END IF;
  current_machines:=ARRAY(SELECT "machineId" FROM maintenance."MachineAccess" WHERE "membershipId"=member.id AND "orgId"=p_org ORDER BY "machineId");
  IF member."teamVersion"<>(p->>'version')::int OR to_jsonb(current_machines)<>p->'expectedMachineIds' THEN RAISE EXCEPTION 'TEAM_CONFLICT'; END IF;
  role_value:=(p->>'role')::maintenance."Role"; is_active:=(p->>'active')::boolean;
  IF NOT(is_active AND role_value='ADMINISTRATOR') AND (member.role='ADMINISTRATOR' OR EXISTS(SELECT 1 FROM maintenance."MembershipRoleGrant" WHERE "membershipId"=member.id AND role='ADMINISTRATOR' AND active)) AND
   NOT EXISTS(SELECT 1 FROM maintenance."Membership" m WHERE m."orgId"=p_org AND m.id<>member.id AND m.active AND (m.role='ADMINISTRATOR' OR EXISTS(SELECT 1 FROM maintenance."MembershipRoleGrant" g WHERE g."membershipId"=m.id AND g.role='ADMINISTRATOR' AND g.active))) THEN RAISE EXCEPTION 'TEAM_LAST_ADMIN'; END IF;
  IF EXISTS(SELECT 1 FROM maintenance."MembershipRoleGrant" WHERE "membershipId"=member.id AND active) AND NOT coalesce((p->>'replaceAdditionalRoles')::boolean,false) THEN RAISE EXCEPTION 'TEAM_ROLE_CONFIRMATION'; END IF;
  machines:=ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p->'machineIds'));
  IF is_active AND role_value IN ('OPERATOR','TECHNICIAN') AND cardinality(machines)=0 THEN RAISE EXCEPTION 'TEAM_MACHINES'; END IF;
  IF cardinality(machines)<>(SELECT count(DISTINCT m.id) FROM maintenance."Machine" m WHERE m."orgId"=p_org AND m.id=ANY(machines) AND (m."archivedAt" IS NULL OR m.id=ANY(current_machines))) THEN RAISE EXCEPTION 'TEAM_MACHINES'; END IF;
  UPDATE maintenance."Membership" SET role=role_value,active=is_active,"teamVersion"="teamVersion"+1,"updatedAt"=moment WHERE id=member.id;
  UPDATE maintenance."AppUser" SET "displayName"=p->>'displayName' WHERE id=member."userId";
  UPDATE maintenance."MembershipRoleGrant" SET active=false WHERE "membershipId"=member.id AND active;
  DELETE FROM maintenance."MachineAccess" WHERE "membershipId"=member.id AND "orgId"=p_org AND NOT("machineId"=ANY(machines));
  INSERT INTO maintenance."MachineAccess"("orgId","machineId","membershipId") SELECT p_org,x,member.id FROM unnest(machines) x ON CONFLICT DO NOTHING;
  UPDATE maintenance."Machine" SET version=version+1,"updatedAt"=moment WHERE "orgId"=p_org AND id=ANY(ARRAY(SELECT unnest(machines) UNION SELECT unnest(current_machines)));
  IF NOT(is_active AND role_value='ADMINISTRATOR') THEN
   WITH revoked AS (UPDATE maintenance."TeamInvitation" SET status='REVOKED',"revokedAt"=moment,version=version+1 WHERE "orgId"=p_org AND "createdBy"=member."userId" AND status='PENDING' RETURNING id)
   INSERT INTO maintenance."AuditEvent"(id,"orgId","actorId",action,"entityId",detail,at) SELECT gen_random_uuid(),p_org,p_actor,'TEAM_INVITATION_REVOKED',id::text,jsonb_build_object('actorRole','ADMINISTRATOR','reason','Inviter no longer has active Administrator authority'),moment FROM revoked;
  END IF;
  result:=jsonb_build_object('id',member.id,'version',member."teamVersion"+1,'alreadyApplied',false,'previousRole',member.role,'previousActive',member.active);
 ELSIF p_action='EMAIL_RESERVE' THEN
  SELECT * INTO inv FROM maintenance."TeamInvitation" WHERE id=p_target AND "orgId"=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_NOT_FOUND'; END IF;
  IF inv.status<>'PENDING' OR inv."expiresAt"<=moment THEN RAISE EXCEPTION 'TEAM_CONFLICT'; END IF;
  IF (SELECT count(*) FROM maintenance."TeamInvitationEmail" WHERE "orgId"=p_org AND "createdAt">moment-interval '1 hour')>=30 OR EXISTS(SELECT 1 FROM maintenance."TeamInvitationEmail" WHERE "invitationId"=inv.id AND "createdAt">moment-interval '2 minutes') THEN RAISE EXCEPTION 'TEAM_RATE_LIMITED'; END IF;
  INSERT INTO maintenance."TeamInvitationEmail"(id,"orgId","invitationId","actorId","requestId","leaseUntil") VALUES(p_request,p_org,inv.id,p_actor,p_request,moment+interval '60 seconds');
  result:=jsonb_build_object('id',p_request,'alreadyApplied',false);
 ELSE RAISE EXCEPTION 'TEAM_INVALID'; END IF;
 INSERT INTO maintenance."TeamAction"(id,"orgId","actorId","requestId",action,"targetId",fingerprint,result,at) VALUES(gen_random_uuid(),p_org,p_actor,p_request,p_action,p_target,fingerprint,result,moment);
 INSERT INTO maintenance."AuditEvent"(id,"orgId","actorId",action,"entityId",detail,at) VALUES(gen_random_uuid(),p_org,p_actor,'TEAM_'||p_action,p_target::text,jsonb_build_object('actorRole','ADMINISTRATOR','requestId',p_request,'change',p-'tokenHash','result',result),moment);
 RETURN result;
END $$;

CREATE FUNCTION maintenance.team_accept_invitation(p_id uuid,p_user uuid,p_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE inv maintenance."TeamInvitation"; member maintenance."Membership"; moment timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO inv FROM maintenance."TeamInvitation" WHERE id=p_id;
 IF NOT FOUND OR inv.email<>lower(p_email) THEN RAISE EXCEPTION 'TEAM_NOT_FOUND'; END IF;
 PERFORM 1 FROM maintenance."Organization" WHERE id=inv."orgId" FOR UPDATE;
 SELECT * INTO inv FROM maintenance."TeamInvitation" WHERE id=p_id FOR UPDATE;
 IF inv.status='ACCEPTED' AND inv."acceptedBy"=p_user THEN
  SELECT * INTO member FROM maintenance."Membership" WHERE "userId"=p_user AND "orgId"=inv."orgId" AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_FORBIDDEN'; END IF;
  RETURN jsonb_build_object('membershipId',member.id,'role',member.role,'alreadyApplied',true);
 END IF;
 IF inv.status<>'PENDING' OR inv."expiresAt"<=moment OR NOT EXISTS(SELECT 1 FROM maintenance."Membership" m WHERE m."orgId"=inv."orgId" AND m."userId"=inv."createdBy" AND m.active AND (m.role='ADMINISTRATOR' OR EXISTS(SELECT 1 FROM maintenance."MembershipRoleGrant" g WHERE g."membershipId"=m.id AND g.role='ADMINISTRATOR' AND g.active))) THEN RAISE EXCEPTION 'TEAM_CONFLICT'; END IF;
 IF EXISTS(SELECT 1 FROM maintenance."Membership" WHERE "userId"=p_user) THEN RAISE EXCEPTION 'TEAM_MEMBER_EXISTS'; END IF;
 PERFORM 1 FROM maintenance."Machine" WHERE "orgId"=inv."orgId" AND id=ANY(inv."machineIds") ORDER BY id FOR UPDATE;
 IF cardinality(inv."machineIds")<>(SELECT count(*) FROM maintenance."Machine" WHERE "orgId"=inv."orgId" AND id=ANY(inv."machineIds") AND "archivedAt" IS NULL) THEN RAISE EXCEPTION 'TEAM_MACHINES'; END IF;
 INSERT INTO maintenance."AppUser"(id,"displayName") VALUES(p_user,inv."displayName") ON CONFLICT(id) DO NOTHING;
 INSERT INTO maintenance."Membership"(id,"userId","orgId",role,active,"updatedAt","staffEmail") VALUES(gen_random_uuid(),p_user,inv."orgId",inv.role,true,moment,inv.email) RETURNING * INTO member;
 INSERT INTO maintenance."MachineAccess"("orgId","machineId","membershipId") SELECT inv."orgId",x,member.id FROM unnest(inv."machineIds") x;
 UPDATE maintenance."Machine" SET version=version+1,"updatedAt"=moment WHERE "orgId"=inv."orgId" AND id=ANY(inv."machineIds");
 UPDATE maintenance."TeamInvitation" SET status='ACCEPTED',"acceptedBy"=p_user,"acceptedAt"=moment,version=version+1 WHERE id=inv.id;
 INSERT INTO maintenance."AuditEvent"(id,"orgId","actorId",action,"entityId",detail,at) VALUES(gen_random_uuid(),inv."orgId",p_user,'TEAM_INVITATION_ACCEPTED',inv.id::text,jsonb_build_object('membershipId',member.id,'role',inv.role,'machineIds',inv."machineIds",'invitedBy',inv."createdBy"),moment);
 RETURN jsonb_build_object('membershipId',member.id,'role',member.role,'alreadyApplied',false);
END $$;

CREATE FUNCTION maintenance.team_email_result(p_id uuid,p_status text,p_code text,p_provider text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE delivery maintenance."TeamInvitationEmail"; moment timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO delivery FROM maintenance."TeamInvitationEmail" WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR delivery.status<>'PENDING' THEN RETURN; END IF;
 IF p_status NOT IN ('SENT','FAILED','UNCERTAIN') THEN RAISE EXCEPTION 'TEAM_INVALID'; END IF;
 UPDATE maintenance."TeamInvitationEmail" SET status=p_status,code=p_code,"providerId"=p_provider,"finishedAt"=moment WHERE id=p_id;
 INSERT INTO maintenance."AuditEvent"(id,"orgId","actorId",action,"entityId",detail,at) VALUES(gen_random_uuid(),delivery."orgId",delivery."actorId",'TEAM_INVITATION_EMAIL_RESULT',delivery."invitationId"::text,jsonb_build_object('deliveryId',p_id,'status',p_status,'code',p_code,'providerId',p_provider),moment);
END $$;
CREATE FUNCTION maintenance.team_action_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Team action receipts are immutable'; END $$;
CREATE TRIGGER team_action_immutable BEFORE UPDATE OR DELETE ON maintenance."TeamAction" FOR EACH ROW EXECUTE FUNCTION maintenance.team_action_immutable();
REVOKE ALL ON maintenance."TeamInvitation",maintenance."TeamAction",maintenance."TeamInvitationEmail" FROM PUBLIC;
REVOKE ALL ON FUNCTION maintenance.team_admin_action(uuid,uuid,uuid,text,uuid,jsonb),maintenance.team_accept_invitation(uuid,uuid,text),maintenance.team_email_result(uuid,text,text,text),maintenance.team_action_immutable() FROM PUBLIC;

DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON maintenance."TeamInvitation",maintenance."TeamAction",maintenance."TeamInvitationEmail" FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION maintenance.team_admin_action(uuid,uuid,uuid,text,uuid,jsonb),maintenance.team_accept_invitation(uuid,uuid,text),maintenance.team_email_result(uuid,text,text,text),maintenance.team_action_immutable() FROM %I',r);
 END IF; END LOOP; END $$;
