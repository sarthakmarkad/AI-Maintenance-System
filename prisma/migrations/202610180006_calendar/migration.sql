-- CreateEnum
CREATE TYPE "maintenance"."WorkOrderKind" AS ENUM ('BREAKDOWN', 'PLANNED');

-- CreateEnum
CREATE TYPE "maintenance"."MaintenanceFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "maintenance"."MaintenanceReminderKind" AS ENUM ('UPCOMING', 'DUE', 'OVERDUE');

-- AlterTable
ALTER TABLE "maintenance"."WorkOrder" ADD COLUMN     "kind" "maintenance"."WorkOrderKind" NOT NULL DEFAULT 'BREAKDOWN',
ADD COLUMN     "occurrenceId" UUID,
ADD COLUMN     "performedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "maintenance"."MaintenancePlan" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "instructions" TEXT NOT NULL,
    "frequency" "maintenance"."MaintenanceFrequency" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "firstDueAt" TIMESTAMPTZ(3) NOT NULL,
    "technicianId" UUID NOT NULL,
    "priority" "maintenance"."WorkOrderPriority" NOT NULL DEFAULT 'NORMAL',
    "remindDays" INTEGER NOT NULL DEFAULT 3,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "pauseReason" TEXT,
    "nextSequence" INTEGER NOT NULL DEFAULT 0,
    "lastGeneratedAt" TIMESTAMPTZ(3),
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MaintenancePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."MaintenanceOccurrence" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "remindAt" TIMESTAMPTZ(3) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "instructions" TEXT NOT NULL,
    "technicianId" UUID NOT NULL,
    "priority" "maintenance"."WorkOrderPriority" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "skippedAt" TIMESTAMPTZ(3),
    "skippedBy" UUID,
    "skipReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."MaintenanceReminder" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "occurrenceId" UUID NOT NULL,
    "kind" "maintenance"."MaintenanceReminderKind" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."MaintenanceReminderReceipt" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "reminderId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "maintenance"."Role" NOT NULL,
    "readAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceReminderReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenancePlan_active_id_idx" ON "maintenance"."MaintenancePlan"("active", "id");

-- CreateIndex
CREATE INDEX "MaintenancePlan_orgId_machineId_createdAt_idx" ON "maintenance"."MaintenancePlan"("orgId", "machineId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenancePlan_orgId_machineId_id_key" ON "maintenance"."MaintenancePlan"("orgId", "machineId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenancePlan_orgId_createdBy_requestId_key" ON "maintenance"."MaintenancePlan"("orgId", "createdBy", "requestId");

-- CreateIndex
CREATE INDEX "MaintenanceOccurrence_orgId_machineId_dueAt_id_idx" ON "maintenance"."MaintenanceOccurrence"("orgId", "machineId", "dueAt", "id");

-- CreateIndex
CREATE INDEX "MaintenanceOccurrence_dueAt_remindAt_idx" ON "maintenance"."MaintenanceOccurrence"("dueAt", "remindAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceOccurrence_orgId_machineId_id_key" ON "maintenance"."MaintenanceOccurrence"("orgId", "machineId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceOccurrence_planId_sequence_key" ON "maintenance"."MaintenanceOccurrence"("planId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceOccurrence_planId_dueAt_key" ON "maintenance"."MaintenanceOccurrence"("planId", "dueAt");

-- CreateIndex
CREATE INDEX "MaintenanceReminder_orgId_machineId_createdAt_idx" ON "maintenance"."MaintenanceReminder"("orgId", "machineId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceReminder_occurrenceId_kind_key" ON "maintenance"."MaintenanceReminder"("occurrenceId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceReminder_orgId_machineId_id_key" ON "maintenance"."MaintenanceReminder"("orgId", "machineId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceReminderReceipt_reminderId_userId_role_key" ON "maintenance"."MaintenanceReminderReceipt"("reminderId", "userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_occurrenceId_key" ON "maintenance"."WorkOrder"("occurrenceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_orgId_machineId_occurrenceId_key" ON "maintenance"."WorkOrder"("orgId", "machineId", "occurrenceId");

-- AddForeignKey
ALTER TABLE "maintenance"."WorkOrder" ADD CONSTRAINT "WorkOrder_orgId_machineId_occurrenceId_fkey" FOREIGN KEY ("orgId", "machineId", "occurrenceId") REFERENCES "maintenance"."MaintenanceOccurrence"("orgId", "machineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_orgId_machineId_fkey" FOREIGN KEY ("orgId", "machineId") REFERENCES "maintenance"."Machine"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_orgId_createdBy_fkey" FOREIGN KEY ("orgId", "createdBy") REFERENCES "maintenance"."Membership"("orgId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_orgId_technicianId_fkey" FOREIGN KEY ("orgId", "technicianId") REFERENCES "maintenance"."Membership"("orgId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."MaintenanceOccurrence" ADD CONSTRAINT "MaintenanceOccurrence_orgId_machineId_fkey" FOREIGN KEY ("orgId", "machineId") REFERENCES "maintenance"."Machine"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."MaintenanceOccurrence" ADD CONSTRAINT "MaintenanceOccurrence_orgId_machineId_planId_fkey" FOREIGN KEY ("orgId", "machineId", "planId") REFERENCES "maintenance"."MaintenancePlan"("orgId", "machineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."MaintenanceOccurrence" ADD CONSTRAINT "MaintenanceOccurrence_orgId_technicianId_fkey" FOREIGN KEY ("orgId", "technicianId") REFERENCES "maintenance"."Membership"("orgId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."MaintenanceOccurrence" ADD CONSTRAINT "MaintenanceOccurrence_orgId_skippedBy_fkey" FOREIGN KEY ("orgId", "skippedBy") REFERENCES "maintenance"."Membership"("orgId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."MaintenanceReminder" ADD CONSTRAINT "MaintenanceReminder_orgId_machineId_occurrenceId_fkey" FOREIGN KEY ("orgId", "machineId", "occurrenceId") REFERENCES "maintenance"."MaintenanceOccurrence"("orgId", "machineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."MaintenanceReminderReceipt" ADD CONSTRAINT "MaintenanceReminderReceipt_orgId_machineId_reminderId_fkey" FOREIGN KEY ("orgId", "machineId", "reminderId") REFERENCES "maintenance"."MaintenanceReminder"("orgId", "machineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."MaintenanceReminderReceipt" ADD CONSTRAINT "MaintenanceReminderReceipt_orgId_userId_fkey" FOREIGN KEY ("orgId", "userId") REFERENCES "maintenance"."Membership"("orgId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE maintenance."WorkOrder" DROP CONSTRAINT work_order_submission;
ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT work_order_kind CHECK ((kind='BREAKDOWN' AND "occurrenceId" IS NULL AND "performedAt" IS NULL) OR (kind='PLANNED' AND "occurrenceId" IS NOT NULL AND impact='OBSERVATION' AND "rootCause" IS NULL AND "restoredAt" IS NULL));
ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT work_order_performed CHECK ("performedAt" IS NULL OR "performedAt" BETWEEN "reportedAt" AND "updatedAt");
ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT work_order_submission CHECK (status NOT IN ('AWAITING_REVIEW','APPROVED','CLOSED') OR ("submittedAt" IS NOT NULL AND "submittedAt" <= "updatedAt" AND findings IS NOT NULL AND length(btrim(findings)) >= 3 AND "correctiveAction" IS NOT NULL AND length(btrim("correctiveAction")) >= 3 AND ((kind='BREAKDOWN' AND "restoredAt" IS NOT NULL AND "restoredAt" <= "submittedAt" AND "rootCause" IS NOT NULL AND length(btrim("rootCause")) >= 3 AND "preventiveAction" IS NOT NULL AND length(btrim("preventiveAction")) >= 3) OR (kind='PLANNED' AND "performedAt" IS NOT NULL AND "performedAt" <= "submittedAt"))));
ALTER TABLE maintenance."WorkOrderEvent" DROP CONSTRAINT work_order_event_action;
ALTER TABLE maintenance."WorkOrderEvent" ADD CONSTRAINT work_order_event_action CHECK (action IN ('REPORT','SCHEDULE','ASSIGN','START','SUBMIT','APPROVE','RETURN','CLOSE') AND version > 0);
ALTER TABLE maintenance."MaintenancePlan" ADD CONSTRAINT maintenance_plan_values CHECK (version > 0 AND "nextSequence" >= 0 AND interval BETWEEN 1 AND 12 AND "remindDays" BETWEEN 1 AND 14 AND length(btrim(title)) BETWEEN 3 AND 160 AND length(btrim(instructions)) BETWEEN 3 AND 4000 AND (active OR ("pauseReason" IS NOT NULL AND length(btrim("pauseReason")) BETWEEN 3 AND 4000)));
ALTER TABLE maintenance."MaintenanceOccurrence" ADD CONSTRAINT maintenance_occurrence_values CHECK (sequence >= 0 AND version BETWEEN 1 AND 2 AND "remindAt" <= "dueAt" AND (("skippedAt" IS NULL AND "skippedBy" IS NULL AND "skipReason" IS NULL) OR ("skippedAt" IS NOT NULL AND "skippedBy" IS NOT NULL AND length(btrim("skipReason")) BETWEEN 3 AND 4000 AND "skipReason" IS NOT NULL)));
ALTER TABLE maintenance."MaintenanceReminderReceipt" ADD CONSTRAINT maintenance_receipt_role CHECK (role IN ('MAINTENANCE_HEAD','SUPERVISOR','TECHNICIAN'));
CREATE TRIGGER maintenance_reminder_immutable BEFORE UPDATE OR DELETE ON maintenance."MaintenanceReminder" FOR EACH ROW EXECUTE FUNCTION maintenance.prevent_audit_change();
CREATE TRIGGER maintenance_receipt_immutable BEFORE UPDATE OR DELETE ON maintenance."MaintenanceReminderReceipt" FOR EACH ROW EXECUTE FUNCTION maintenance.prevent_audit_change();
CREATE FUNCTION maintenance.check_plan_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.active IS DISTINCT FROM OLD.active OR NEW."pauseReason" IS DISTINCT FROM OLD."pauseReason" THEN
  IF NEW.version <> OLD.version+1 THEN RAISE EXCEPTION 'Invalid maintenance plan version'; END IF;
 ELSIF NEW.version <> OLD.version THEN RAISE EXCEPTION 'Scheduler cannot change plan version'; END IF;
 IF NEW."nextSequence" < OLD."nextSequence" OR NEW."nextSequence" > OLD."nextSequence"+128 THEN RAISE EXCEPTION 'Invalid schedule cursor'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER maintenance_plan_update BEFORE UPDATE ON maintenance."MaintenancePlan" FOR EACH ROW EXECUTE FUNCTION maintenance.check_plan_update();
CREATE FUNCTION maintenance.check_occurrence_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."skippedAt" IS NOT NULL OR NEW.version <> OLD.version+1 THEN RAISE EXCEPTION 'Invalid occurrence update'; END IF;
 IF NEW."skippedAt" IS NOT NULL AND EXISTS (SELECT 1 FROM maintenance."WorkOrder" WHERE "occurrenceId"=OLD.id) THEN RAISE EXCEPTION 'Released work cannot be skipped'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER maintenance_occurrence_update BEFORE UPDATE ON maintenance."MaintenanceOccurrence" FOR EACH ROW EXECUTE FUNCTION maintenance.check_occurrence_update();
CREATE FUNCTION maintenance.check_planned_work_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='PLANNED' THEN
  PERFORM id FROM maintenance."MaintenanceOccurrence" WHERE id=NEW."occurrenceId" AND "orgId"=NEW."orgId" AND "machineId"=NEW."machineId" AND "skippedAt" IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'A pending scoped occurrence is required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER maintenance_planned_work_insert BEFORE INSERT ON maintenance."WorkOrder" FOR EACH ROW EXECUTE FUNCTION maintenance.check_planned_work_insert();
REVOKE ALL ON maintenance."MaintenancePlan", maintenance."MaintenanceOccurrence", maintenance."MaintenanceReminder", maintenance."MaintenanceReminderReceipt" FROM PUBLIC;
