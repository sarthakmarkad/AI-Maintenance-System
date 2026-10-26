-- Extend head handoffs to existing and new unassigned operator breakdown reports.
-- Retain the previously applied migration and every original event/receipt.
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
 ) OR NOT EXISTS (SELECT 1 FROM maintenance."Machine" WHERE id=NEW."machineId" AND "orgId"=NEW."orgId" AND code='WH-C')
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
