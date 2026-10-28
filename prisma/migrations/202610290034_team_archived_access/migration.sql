-- Do not reinsert already retained grants: archived machines reject fresh access inserts.
CREATE OR REPLACE FUNCTION maintenance.team_admin_action(p_org uuid,p_actor uuid,p_request uuid,p_action text,p_target uuid,p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior maintenance."TeamAction"; inv maintenance."TeamInvitation"; member maintenance."Membership";
 delivery maintenance."TeamInvitationEmail"; result jsonb; fingerprint text; machines uuid[]; current_machines uuid[];
 actor_member uuid; role_value maintenance."Role"; is_active boolean; moment timestamptz:=clock_timestamp();
BEGIN
 PERFORM 1 FROM maintenance."Organization" WHERE id=p_org FOR UPDATE;
 moment:=clock_timestamp();
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
  IF inv.version IS DISTINCT FROM (p->>'version')::int OR inv.status<>'PENDING' THEN RAISE EXCEPTION 'TEAM_CONFLICT'; END IF;
  UPDATE maintenance."TeamInvitation" SET status='REVOKED',"revokedAt"=moment,version=version+1 WHERE id=inv.id;
  result:=jsonb_build_object('id',inv.id,'version',inv.version+1,'alreadyApplied',false);
 ELSIF p_action='UPDATE_MEMBER' THEN
  IF coalesce(length(btrim(p->>'reason')),0) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'TEAM_INVALID'; END IF;
  -- Lock machines before memberships, consistently with machine-access administration.
  PERFORM 1 FROM maintenance."Machine" WHERE "orgId"=p_org ORDER BY id FOR UPDATE;
  SELECT * INTO member FROM maintenance."Membership" WHERE id=p_target AND "orgId"=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_NOT_FOUND'; END IF;
  IF member."userId"=p_actor THEN RAISE EXCEPTION 'TEAM_SELF'; END IF;
  current_machines:=ARRAY(SELECT "machineId" FROM maintenance."MachineAccess" WHERE "membershipId"=member.id AND "orgId"=p_org ORDER BY "machineId");
  IF member."teamVersion" IS DISTINCT FROM (p->>'version')::int OR to_jsonb(current_machines)<>p->'expectedMachineIds' THEN RAISE EXCEPTION 'TEAM_CONFLICT'; END IF;
  role_value:=(p->>'role')::maintenance."Role"; is_active:=(p->>'active')::boolean;
  IF NOT(is_active AND role_value='ADMINISTRATOR') AND (member.role='ADMINISTRATOR' OR EXISTS(SELECT 1 FROM maintenance."MembershipRoleGrant" WHERE "membershipId"=member.id AND role='ADMINISTRATOR' AND active)) AND
   NOT EXISTS(SELECT 1 FROM maintenance."Membership" m WHERE m."orgId"=p_org AND m.id<>member.id AND m.active AND (m.role='ADMINISTRATOR' OR EXISTS(SELECT 1 FROM maintenance."MembershipRoleGrant" g WHERE g."membershipId"=m.id AND g.role='ADMINISTRATOR' AND g.active))) THEN RAISE EXCEPTION 'TEAM_LAST_ADMIN'; END IF;
  IF EXISTS(SELECT 1 FROM maintenance."MembershipRoleGrant" WHERE "membershipId"=member.id AND role<>member.role AND active) AND NOT coalesce((p->>'replaceAdditionalRoles')::boolean,false) THEN RAISE EXCEPTION 'TEAM_ROLE_CONFIRMATION'; END IF;
  machines:=ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p->'machineIds'));
  IF is_active AND role_value IN ('OPERATOR','TECHNICIAN') AND cardinality(machines)=0 THEN RAISE EXCEPTION 'TEAM_MACHINES'; END IF;
  IF cardinality(machines)<>(SELECT count(DISTINCT m.id) FROM maintenance."Machine" m WHERE m."orgId"=p_org AND m.id=ANY(machines) AND (m."archivedAt" IS NULL OR m.id=ANY(current_machines))) THEN RAISE EXCEPTION 'TEAM_MACHINES'; END IF;
  UPDATE maintenance."Membership" SET role=role_value,active=is_active,"teamVersion"="teamVersion"+1,"updatedAt"=moment WHERE id=member.id;
  UPDATE maintenance."AppUser" SET "displayName"=p->>'displayName' WHERE id=member."userId";
  UPDATE maintenance."MembershipRoleGrant" SET active=false WHERE "membershipId"=member.id AND active;
  DELETE FROM maintenance."MachineAccess" WHERE "membershipId"=member.id AND "orgId"=p_org AND NOT("machineId"=ANY(machines));
  INSERT INTO maintenance."MachineAccess"("orgId","machineId","membershipId") SELECT p_org,x,member.id FROM unnest(machines) x WHERE NOT EXISTS(SELECT 1 FROM maintenance."MachineAccess" a WHERE a."orgId"=p_org AND a."membershipId"=member.id AND a."machineId"=x) ON CONFLICT DO NOTHING;
  UPDATE maintenance."Machine" SET version=version+1,"updatedAt"=moment WHERE "orgId"=p_org AND "archivedAt" IS NULL AND id=ANY(ARRAY(SELECT unnest(machines) UNION SELECT unnest(current_machines)));
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

