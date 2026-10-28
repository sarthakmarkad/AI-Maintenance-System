-- SQL CHECK permits UNKNOWN: require the hash explicitly for a retained key.
ALTER TABLE maintenance."Machine" DROP CONSTRAINT machine_registration_receipt;
ALTER TABLE maintenance."Machine" ADD CONSTRAINT machine_registration_receipt CHECK (
 ("registrationKey" IS NULL AND "registrationHash" IS NULL) OR
 ("registrationKey" IS NOT NULL AND "registrationHash" IS NOT NULL AND "registrationHash" ~ '^[0-9a-f]{64}$')
);
