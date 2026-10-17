-- CreateEnum
CREATE TYPE "maintenance"."ProductionSource" AS ENUM ('AUTHENTIC', 'SYNTHETIC');

-- CreateEnum
CREATE TYPE "maintenance"."ProductionImportStatus" AS ENUM ('PREVIEW', 'COMMITTED');

-- CreateEnum
CREATE TYPE "maintenance"."ProductionShift" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "maintenance"."ProductionRowKind" AS ENUM ('JOB', 'ACTIVITY');

-- CreateTable
CREATE TABLE "maintenance"."ProductionImport" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "source" "maintenance"."ProductionSource" NOT NULL,
    "filename" VARCHAR(180) NOT NULL,
    "workbookHash" VARCHAR(64) NOT NULL,
    "sheet" VARCHAR(100) NOT NULL,
    "parserVersion" VARCHAR(40) NOT NULL,
    "status" "maintenance"."ProductionImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "staged" JSONB NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "committedAt" TIMESTAMPTZ(3),
    "committedDayKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "ProductionImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."ProductionDay" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "source" "maintenance"."ProductionSource" NOT NULL,
    "date" DATE NOT NULL,
    "productionKg" DECIMAL(16,3) NOT NULL,
    "scrapKg" DECIMAL(16,3) NOT NULL,
    "controlProductionKg" DECIMAL(16,3) NOT NULL,
    "controlScrapKg" DECIMAL(16,3) NOT NULL,
    "sourceStartRow" INTEGER NOT NULL,
    "sourceEndRow" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."ProductionRow" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "dayId" UUID NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "kind" "maintenance"."ProductionRowKind" NOT NULL,
    "shift" "maintenance"."ProductionShift" NOT NULL,
    "description" TEXT NOT NULL,
    "productionKg" DECIMAL(16,3),
    "jobChanges" INTEGER,
    "scrap" JSONB NOT NULL,
    "downtime" JSONB NOT NULL,
    "downtimeUnit" VARCHAR(20) NOT NULL DEFAULT 'UNCONFIRMED',
    "remarks" TEXT NOT NULL,
    "rawCells" JSONB NOT NULL,

    CONSTRAINT "ProductionRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionImport_orgId_machineId_createdAt_idx" ON "maintenance"."ProductionImport"("orgId", "machineId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductionImport_createdBy_idx" ON "maintenance"."ProductionImport"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionImport_orgId_machineId_source_id_key" ON "maintenance"."ProductionImport"("orgId", "machineId", "source", "id");

-- CreateIndex
CREATE INDEX "ProductionDay_importId_idx" ON "maintenance"."ProductionDay"("importId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionDay_orgId_machineId_source_date_key" ON "maintenance"."ProductionDay"("orgId", "machineId", "source", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionDay_orgId_machineId_id_key" ON "maintenance"."ProductionDay"("orgId", "machineId", "id");

-- CreateIndex
CREATE INDEX "ProductionRow_orgId_machineId_idx" ON "maintenance"."ProductionRow"("orgId", "machineId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionRow_dayId_sourceRow_key" ON "maintenance"."ProductionRow"("dayId", "sourceRow");

-- AddForeignKey
ALTER TABLE "maintenance"."ProductionImport" ADD CONSTRAINT "ProductionImport_orgId_machineId_fkey" FOREIGN KEY ("orgId", "machineId") REFERENCES "maintenance"."Machine"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."ProductionImport" ADD CONSTRAINT "ProductionImport_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "maintenance"."AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."ProductionDay" ADD CONSTRAINT "ProductionDay_orgId_machineId_fkey" FOREIGN KEY ("orgId", "machineId") REFERENCES "maintenance"."Machine"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."ProductionDay" ADD CONSTRAINT "ProductionDay_orgId_machineId_source_importId_fkey" FOREIGN KEY ("orgId", "machineId", "source", "importId") REFERENCES "maintenance"."ProductionImport"("orgId", "machineId", "source", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."ProductionRow" ADD CONSTRAINT "ProductionRow_orgId_machineId_dayId_fkey" FOREIGN KEY ("orgId", "machineId", "dayId") REFERENCES "maintenance"."ProductionDay"("orgId", "machineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE maintenance."ProductionDay" ADD CONSTRAINT production_day_totals CHECK (
 "productionKg" >= 0 AND "scrapKg" >= 0 AND "controlProductionKg" >= 0 AND "controlScrapKg" >= 0
 AND abs("productionKg" - "controlProductionKg") <= 0.01 AND abs("scrapKg" - "controlScrapKg") <= 0.01
 AND "sourceStartRow" >= 8 AND "sourceEndRow" >= "sourceStartRow"
);
ALTER TABLE maintenance."ProductionRow" ADD CONSTRAINT production_row_values CHECK (
 ("productionKg" IS NULL OR "productionKg" >= 0) AND ("jobChanges" IS NULL OR "jobChanges" >= 0)
 AND "sourceRow" >= 8 AND "downtimeUnit" = 'UNCONFIRMED'
 AND (kind != 'JOB' OR (length(trim(description)) > 0 AND "productionKg" IS NOT NULL))
 AND (kind != 'ACTIVITY' OR "productionKg" IS NULL OR "productionKg" = 0)
);
ALTER TABLE maintenance."ProductionImport" ADD CONSTRAINT production_import_state CHECK (
 "workbookHash" ~ '^[a-f0-9]{64}$' AND
 ((status='PREVIEW' AND "committedAt" IS NULL AND cardinality("committedDayKeys")=0)
 OR (status='COMMITTED' AND "committedAt" IS NOT NULL AND cardinality("committedDayKeys")>=1))
);
REVOKE ALL ON maintenance."ProductionImport", maintenance."ProductionDay", maintenance."ProductionRow" FROM PUBLIC;
