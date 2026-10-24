-- Workflow events are the durable notification source, including retained
-- historical events. No backfill, fabricated operational rows or worker writes.
CREATE UNIQUE INDEX "WorkOrderEvent_orgId_machineId_id_key" ON maintenance."WorkOrderEvent"("orgId","machineId",id);
CREATE TABLE maintenance."WorkOrderNotificationReceipt" (
 id UUID PRIMARY KEY,
 "orgId" UUID NOT NULL,
 "machineId" UUID NOT NULL,
 "eventId" UUID NOT NULL,
 "userId" UUID NOT NULL,
 role maintenance."Role" NOT NULL,
 "readAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT notification_receipt_role CHECK (role IN ('TECHNICIAN','MAINTENANCE_HEAD')),
 CONSTRAINT "WorkOrderNotificationReceipt_event_fkey" FOREIGN KEY ("orgId","machineId","eventId") REFERENCES maintenance."WorkOrderEvent"("orgId","machineId",id) ON DELETE RESTRICT,
 CONSTRAINT "WorkOrderNotificationReceipt_reader_fkey" FOREIGN KEY ("orgId","userId") REFERENCES maintenance."Membership"("orgId","userId") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "WorkOrderNotificationReceipt_eventId_userId_role_key" ON maintenance."WorkOrderNotificationReceipt"("eventId","userId",role);
CREATE INDEX "WorkOrderNotificationReceipt_orgId_machineId_userId_role_idx" ON maintenance."WorkOrderNotificationReceipt"("orgId","machineId","userId",role);
CREATE TRIGGER work_order_notification_receipt_immutable BEFORE UPDATE OR DELETE ON maintenance."WorkOrderNotificationReceipt" FOR EACH ROW EXECUTE FUNCTION maintenance.prevent_audit_change();

CREATE FUNCTION maintenance.check_work_order_notification_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
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
   (NEW.role='MAINTENANCE_HEAD' AND e.action='SUBMIT' AND o.status='AWAITING_REVIEW') OR
   (NEW.role='TECHNICIAN' AND o."technicianId"=NEW."userId" AND (
     (e.action IN ('ASSIGN','SCHEDULE','INVESTIGATE') AND o.status='ASSIGNED') OR
     (e.action='RETURN' AND o.status='IN_PROGRESS')
   ))
 ) THEN RAISE EXCEPTION 'Notification is not actionable for this recipient'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER work_order_notification_receipt_insert BEFORE INSERT ON maintenance."WorkOrderNotificationReceipt" FOR EACH ROW EXECUTE FUNCTION maintenance.check_work_order_notification_receipt();
REVOKE ALL ON maintenance."WorkOrderNotificationReceipt" FROM PUBLIC;
