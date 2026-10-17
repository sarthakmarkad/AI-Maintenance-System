-- CreateEnum
CREATE TYPE "maintenance"."ReadingImportStatus" AS ENUM ('PREVIEW', 'COMMITTED');

-- CreateTable
CREATE TABLE "maintenance"."ReadingImport" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "source" "maintenance"."ProductionSource" NOT NULL DEFAULT 'SYNTHETIC',
    "filename" VARCHAR(180) NOT NULL,
    "workbookHash" VARCHAR(64) NOT NULL,
    "sheet" VARCHAR(100) NOT NULL DEFAULT 'Hourly_Readings',
    "parserVersion" VARCHAR(50) NOT NULL,
    "policyVersion" VARCHAR(50) NOT NULL,
    "staged" JSONB NOT NULL,
    "status" "maintenance"."ReadingImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "committedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ReadingImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."ProcessReading" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "source" "maintenance"."ProductionSource" NOT NULL DEFAULT 'SYNTHETIC',
    "sourceId" VARCHAR(64) NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "measuredAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "localMeasuredAt" VARCHAR(19) NOT NULL,
    "demoShift" "maintenance"."ProductionShift" NOT NULL,
    "hotTempC" DECIMAL(12,3) NOT NULL,
    "coldTempC" DECIMAL(12,3) NOT NULL,
    "pressureBar" DECIMAL(12,3) NOT NULL,
    "rawCells" JSONB NOT NULL,

    CONSTRAINT "ProcessReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReadingImport_orgId_machineId_createdAt_idx" ON "maintenance"."ReadingImport"("orgId", "machineId", "createdAt");

-- CreateIndex
CREATE INDEX "ReadingImport_createdBy_idx" ON "maintenance"."ReadingImport"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "ReadingImport_orgId_machineId_source_id_key" ON "maintenance"."ReadingImport"("orgId", "machineId", "source", "id");

-- CreateIndex
CREATE INDEX "ProcessReading_importId_idx" ON "maintenance"."ProcessReading"("importId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessReading_orgId_machineId_source_measuredAt_key" ON "maintenance"."ProcessReading"("orgId", "machineId", "source", "measuredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessReading_orgId_machineId_source_sourceId_key" ON "maintenance"."ProcessReading"("orgId", "machineId", "source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessReading_importId_sourceRow_key" ON "maintenance"."ProcessReading"("importId", "sourceRow");

-- AddForeignKey
ALTER TABLE "maintenance"."ReadingImport" ADD CONSTRAINT "ReadingImport_orgId_machineId_fkey" FOREIGN KEY ("orgId", "machineId") REFERENCES "maintenance"."Machine"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."ReadingImport" ADD CONSTRAINT "ReadingImport_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "maintenance"."AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."ProcessReading" ADD CONSTRAINT "ProcessReading_orgId_machineId_fkey" FOREIGN KEY ("orgId", "machineId") REFERENCES "maintenance"."Machine"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."ProcessReading" ADD CONSTRAINT "ProcessReading_orgId_machineId_source_importId_fkey" FOREIGN KEY ("orgId", "machineId", "source", "importId") REFERENCES "maintenance"."ReadingImport"("orgId", "machineId", "source", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE maintenance."ReadingImport" ADD CONSTRAINT "reading_import_source" CHECK (source = 'SYNTHETIC');
ALTER TABLE maintenance."ReadingImport" ADD CONSTRAINT "reading_import_state" CHECK ((status = 'PREVIEW' AND "committedAt" IS NULL) OR (status = 'COMMITTED' AND "committedAt" IS NOT NULL));
ALTER TABLE maintenance."ProcessReading" ADD CONSTRAINT "reading_source" CHECK (source = 'SYNTHETIC');
ALTER TABLE maintenance."ProcessReading" ADD CONSTRAINT "reading_row" CHECK ("sourceRow" BETWEEN 2 AND 1100);
ALTER TABLE maintenance."ProcessReading" ADD CONSTRAINT "reading_hour" CHECK (date_trunc('hour', "measuredAt" AT TIME ZONE 'Asia/Kolkata') = "measuredAt" AT TIME ZONE 'Asia/Kolkata');
ALTER TABLE maintenance."ProcessReading" ADD CONSTRAINT "reading_local_time" CHECK ("localMeasuredAt" = to_char("measuredAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'));
REVOKE ALL ON maintenance."ReadingImport", maintenance."ProcessReading" FROM PUBLIC;
