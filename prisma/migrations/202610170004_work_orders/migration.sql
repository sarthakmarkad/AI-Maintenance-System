-- CreateEnum
CREATE TYPE "maintenance"."WorkOrderStatus" AS ENUM ('REPORTED', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_REVIEW', 'APPROVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "maintenance"."WorkOrderPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "maintenance"."ReportedImpact" AS ENUM ('STOPPED', 'DEGRADED', 'OBSERVATION');

-- CreateTable
CREATE TABLE "maintenance"."WorkOrder" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "reportFingerprint" VARCHAR(64) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "maintenance"."WorkOrderPriority" NOT NULL DEFAULT 'NORMAL',
    "impact" "maintenance"."ReportedImpact" NOT NULL,
    "observedAt" TIMESTAMPTZ(3),
    "reportedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedBy" UUID NOT NULL,
    "status" "maintenance"."WorkOrderStatus" NOT NULL DEFAULT 'REPORTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "technicianId" UUID,
    "startedAt" TIMESTAMPTZ(3),
    "findings" TEXT,
    "rootCause" TEXT,
    "correctiveAction" TEXT,
    "preventiveAction" TEXT,
    "restoredAt" TIMESTAMPTZ(3),
    "submittedAt" TIMESTAMPTZ(3),
    "returnReason" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewedBy" UUID,
    "closedAt" TIMESTAMPTZ(3),
    "closedBy" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."WorkOrderEvent" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "action" VARCHAR(16) NOT NULL,
    "fromStatus" "maintenance"."WorkOrderStatus",
    "toStatus" "maintenance"."WorkOrderStatus" NOT NULL,
    "actorId" UUID NOT NULL,
    "actorName" VARCHAR(120) NOT NULL,
    "actorRole" "maintenance"."Role" NOT NULL,
    "detail" JSONB NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkOrder_orgId_machineId_reportedAt_id_idx" ON "maintenance"."WorkOrder"("orgId", "machineId", "reportedAt", "id");

-- CreateIndex
CREATE INDEX "WorkOrder_orgId_machineId_status_reportedAt_idx" ON "maintenance"."WorkOrder"("orgId", "machineId", "status", "reportedAt");

-- CreateIndex
CREATE INDEX "WorkOrder_orgId_technicianId_idx" ON "maintenance"."WorkOrder"("orgId", "technicianId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_orgId_machineId_id_key" ON "maintenance"."WorkOrder"("orgId", "machineId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_orgId_reportedBy_requestId_key" ON "maintenance"."WorkOrder"("orgId", "reportedBy", "requestId");

-- CreateIndex
CREATE INDEX "WorkOrderEvent_orgId_machineId_orderId_version_idx" ON "maintenance"."WorkOrderEvent"("orgId", "machineId", "orderId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderEvent_orderId_version_key" ON "maintenance"."WorkOrderEvent"("orderId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_orgId_userId_key" ON "maintenance"."Membership"("orgId", "userId");

-- AddForeignKey
ALTER TABLE "maintenance"."WorkOrder" ADD CONSTRAINT "WorkOrder_orgId_machineId_fkey" FOREIGN KEY ("orgId", "machineId") REFERENCES "maintenance"."Machine"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."WorkOrder" ADD CONSTRAINT "WorkOrder_orgId_reportedBy_fkey" FOREIGN KEY ("orgId", "reportedBy") REFERENCES "maintenance"."Membership"("orgId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."WorkOrder" ADD CONSTRAINT "WorkOrder_orgId_technicianId_fkey" FOREIGN KEY ("orgId", "technicianId") REFERENCES "maintenance"."Membership"("orgId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."WorkOrder" ADD CONSTRAINT "WorkOrder_orgId_reviewedBy_fkey" FOREIGN KEY ("orgId", "reviewedBy") REFERENCES "maintenance"."Membership"("orgId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."WorkOrder" ADD CONSTRAINT "WorkOrder_orgId_closedBy_fkey" FOREIGN KEY ("orgId", "closedBy") REFERENCES "maintenance"."Membership"("orgId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."WorkOrderEvent" ADD CONSTRAINT "WorkOrderEvent_orgId_machineId_orderId_fkey" FOREIGN KEY ("orgId", "machineId", "orderId") REFERENCES "maintenance"."WorkOrder"("orgId", "machineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."WorkOrderEvent" ADD CONSTRAINT "WorkOrderEvent_orgId_actorId_fkey" FOREIGN KEY ("orgId", "actorId") REFERENCES "maintenance"."Membership"("orgId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT work_order_version CHECK (version > 0);
ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT work_order_report CHECK (length(btrim(title)) BETWEEN 3 AND 160 AND length(btrim(description)) BETWEEN 3 AND 4000 AND ("observedAt" IS NULL OR "observedAt" <= "reportedAt"));
ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT work_order_assignment CHECK ((status = 'REPORTED' AND "technicianId" IS NULL) OR (status <> 'REPORTED' AND "technicianId" IS NOT NULL));
ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT work_order_start CHECK (("startedAt" IS NULL OR "startedAt" BETWEEN "reportedAt" AND "updatedAt") AND (status NOT IN ('IN_PROGRESS','AWAITING_REVIEW','APPROVED','CLOSED') OR "startedAt" IS NOT NULL));
ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT work_order_restore CHECK ("restoredAt" IS NULL OR "restoredAt" BETWEEN "reportedAt" AND "updatedAt");
ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT work_order_submission CHECK (status NOT IN ('AWAITING_REVIEW','APPROVED','CLOSED') OR ("submittedAt" IS NOT NULL AND "restoredAt" IS NOT NULL AND "restoredAt" <= "submittedAt" AND "submittedAt" <= "updatedAt" AND length(btrim(findings)) >= 3 AND findings IS NOT NULL AND length(btrim("rootCause")) >= 3 AND "rootCause" IS NOT NULL AND length(btrim("correctiveAction")) >= 3 AND "correctiveAction" IS NOT NULL AND length(btrim("preventiveAction")) >= 3 AND "preventiveAction" IS NOT NULL));
ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT work_order_review CHECK ((status IN ('APPROVED','CLOSED') AND "reviewedAt" IS NOT NULL AND "reviewedBy" IS NOT NULL AND "reviewedAt" >= "submittedAt" AND "reviewedAt" <= "updatedAt") OR (status NOT IN ('APPROVED','CLOSED') AND "reviewedAt" IS NULL AND "reviewedBy" IS NULL));
ALTER TABLE maintenance."WorkOrder" ADD CONSTRAINT work_order_closure CHECK ((status = 'CLOSED' AND "closedAt" IS NOT NULL AND "closedBy" IS NOT NULL AND "closedAt" >= "reviewedAt" AND "closedAt" <= "updatedAt") OR (status <> 'CLOSED' AND "closedAt" IS NULL AND "closedBy" IS NULL));
ALTER TABLE maintenance."WorkOrderEvent" ADD CONSTRAINT work_order_event_action CHECK (action IN ('REPORT','ASSIGN','START','SUBMIT','APPROVE','RETURN','CLOSE') AND version > 0);
CREATE TRIGGER work_order_event_immutable BEFORE UPDATE OR DELETE ON maintenance."WorkOrderEvent" FOR EACH ROW EXECUTE FUNCTION maintenance.prevent_audit_change();
CREATE FUNCTION maintenance.check_work_order_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.version <> OLD.version + 1 OR OLD.status = 'CLOSED' THEN RAISE EXCEPTION 'Invalid work order version or terminal state'; END IF;
 IF NOT ((OLD.status='REPORTED' AND NEW.status='ASSIGNED') OR (OLD.status='ASSIGNED' AND NEW.status IN ('ASSIGNED','IN_PROGRESS')) OR (OLD.status='IN_PROGRESS' AND NEW.status IN ('ASSIGNED','AWAITING_REVIEW')) OR (OLD.status='AWAITING_REVIEW' AND NEW.status IN ('IN_PROGRESS','APPROVED')) OR (OLD.status='APPROVED' AND NEW.status='CLOSED')) THEN RAISE EXCEPTION 'Invalid work order state transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER work_order_transition BEFORE UPDATE ON maintenance."WorkOrder" FOR EACH ROW EXECUTE FUNCTION maintenance.check_work_order_transition();
REVOKE ALL ON maintenance."WorkOrder", maintenance."WorkOrderEvent" FROM PUBLIC;
