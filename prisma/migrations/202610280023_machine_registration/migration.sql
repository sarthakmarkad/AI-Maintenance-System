-- Extend the existing registry without changing any machine identity/history.
ALTER TABLE maintenance."Machine"
 ALTER COLUMN manufacturer DROP NOT NULL,
 ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "registrationKey" UUID,
 ADD COLUMN "registrationHash" VARCHAR(64),
 ADD CONSTRAINT machine_registration_receipt CHECK (("registrationKey" IS NULL AND "registrationHash" IS NULL) OR ("registrationKey" IS NOT NULL AND "registrationHash" ~ '^[0-9a-f]{64}$')),
 ADD CONSTRAINT machine_registry_version CHECK (version > 0);
CREATE UNIQUE INDEX "Machine_orgId_registrationKey_key" ON maintenance."Machine" ("orgId","registrationKey");
