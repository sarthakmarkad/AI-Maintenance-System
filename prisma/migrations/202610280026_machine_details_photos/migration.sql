-- Registry photos are current presentation, never work-order evidence.
CREATE TABLE maintenance."MachinePhoto" (
 "machineId" UUID PRIMARY KEY,
 "orgId" UUID NOT NULL,
 id UUID NOT NULL UNIQUE,
 content BYTEA NOT NULL,
 sha256 VARCHAR(64) NOT NULL,
 "byteSize" INTEGER NOT NULL,
 width INTEGER NOT NULL,
 height INTEGER NOT NULL,
 source JSONB NOT NULL,
 "uploadedBy" UUID NOT NULL REFERENCES maintenance."AppUser"(id) ON DELETE RESTRICT,
 "uploaderName" VARCHAR(160) NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT machine_photo_machine FOREIGN KEY ("orgId","machineId") REFERENCES maintenance."Machine"("orgId",id) ON DELETE RESTRICT,
 CONSTRAINT machine_photo_size CHECK ("byteSize" BETWEEN 1 AND 5242880 AND octet_length(content)="byteSize"),
 CONSTRAINT machine_photo_hash CHECK (sha256 ~ '^[0-9a-f]{64}$' AND sha256=encode(sha256(content),'hex')),
 CONSTRAINT machine_photo_dimensions CHECK (width BETWEEN 1 AND 2048 AND height BETWEEN 1 AND 2048),
 CONSTRAINT machine_photo_webp CHECK (substring(content FROM 1 FOR 4)=decode('52494646','hex') AND substring(content FROM 9 FOR 4)=decode('57454250','hex')),
 CONSTRAINT machine_photo_source CHECK (jsonb_typeof(source)='object')
);
CREATE UNIQUE INDEX "MachinePhoto_orgId_machineId_key" ON maintenance."MachinePhoto"("orgId","machineId");
REVOKE ALL ON maintenance."MachinePhoto" FROM PUBLIC;
-- Existing schema isolation also protects all browser roles (no new browser grants).
