-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "maintenance";

-- CreateEnum
CREATE TYPE "maintenance"."Role" AS ENUM ('OPERATOR', 'TECHNICIAN', 'MAINTENANCE_HEAD', 'SUPERVISOR', 'MANAGEMENT', 'ADMINISTRATOR');

-- CreateTable
CREATE TABLE "maintenance"."Organization" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."Department" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."Location" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."AppUser" (
    "id" UUID NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."Membership" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "role" "maintenance"."Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."Machine" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "manufacturer" VARCHAR(160) NOT NULL,
    "model" VARCHAR(160),
    "operationalStatus" VARCHAR(32) NOT NULL DEFAULT 'NOT_MONITORED',
    "departmentId" UUID,
    "locationId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."MachineAccess" (
    "orgId" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineAccess_pkey" PRIMARY KEY ("machineId","membershipId")
);

-- CreateTable
CREATE TABLE "maintenance"."AuditEvent" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entityId" VARCHAR(120) NOT NULL,
    "detail" JSONB NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "maintenance"."Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Department_orgId_id_key" ON "maintenance"."Department"("orgId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Department_orgId_name_key" ON "maintenance"."Department"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Location_orgId_id_key" ON "maintenance"."Location"("orgId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Location_orgId_name_key" ON "maintenance"."Location"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_key" ON "maintenance"."Membership"("userId");

-- CreateIndex
CREATE INDEX "Membership_orgId_role_active_idx" ON "maintenance"."Membership"("orgId", "role", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_orgId_id_key" ON "maintenance"."Membership"("orgId", "id");

-- CreateIndex
CREATE INDEX "Machine_orgId_departmentId_idx" ON "maintenance"."Machine"("orgId", "departmentId");

-- CreateIndex
CREATE INDEX "Machine_orgId_locationId_idx" ON "maintenance"."Machine"("orgId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_orgId_id_key" ON "maintenance"."Machine"("orgId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_orgId_code_key" ON "maintenance"."Machine"("orgId", "code");

-- CreateIndex
CREATE INDEX "MachineAccess_orgId_membershipId_idx" ON "maintenance"."MachineAccess"("orgId", "membershipId");

-- CreateIndex
CREATE INDEX "AuditEvent_orgId_at_idx" ON "maintenance"."AuditEvent"("orgId", "at");

-- AddForeignKey
ALTER TABLE "maintenance"."Department" ADD CONSTRAINT "Department_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "maintenance"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."Location" ADD CONSTRAINT "Location_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "maintenance"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "maintenance"."AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "maintenance"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."Machine" ADD CONSTRAINT "Machine_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "maintenance"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."Machine" ADD CONSTRAINT "Machine_orgId_departmentId_fkey" FOREIGN KEY ("orgId", "departmentId") REFERENCES "maintenance"."Department"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."Machine" ADD CONSTRAINT "Machine_orgId_locationId_fkey" FOREIGN KEY ("orgId", "locationId") REFERENCES "maintenance"."Location"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."MachineAccess" ADD CONSTRAINT "MachineAccess_orgId_machineId_fkey" FOREIGN KEY ("orgId", "machineId") REFERENCES "maintenance"."Machine"("orgId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."MachineAccess" ADD CONSTRAINT "MachineAccess_orgId_membershipId_fkey" FOREIGN KEY ("orgId", "membershipId") REFERENCES "maintenance"."Membership"("orgId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."AuditEvent" ADD CONSTRAINT "AuditEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "maintenance"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "maintenance"."AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Private application schema: browser/Supabase Data API roles have no direct grants.
REVOKE ALL ON SCHEMA maintenance FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA maintenance FROM PUBLIC;
DO $$
DECLARE browser_role text;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname=browser_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA maintenance FROM %I', browser_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA maintenance FROM %I', browser_role);
    END IF;
  END LOOP;
END $$;
-- Protect the audit log even from accidental owner-level UPDATE/DELETE.
CREATE FUNCTION maintenance.prevent_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit events are append-only'; END;
$$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON maintenance."AuditEvent"
FOR EACH ROW EXECUTE FUNCTION maintenance.prevent_audit_change();
ALTER TABLE maintenance."Machine" ADD CONSTRAINT machine_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{0,31}$');
ALTER TABLE maintenance."Machine" ADD CONSTRAINT machine_status_m1 CHECK ("operationalStatus" = 'NOT_MONITORED');
