-- Import retry receipts are a required list in the application contract.
-- Existing values must already be valid; do not fabricate a selection as backfill.
ALTER TABLE maintenance."ProductionImport" ALTER COLUMN "committedDayKeys" SET NOT NULL;
ALTER TABLE maintenance."ProductionImport" ADD CONSTRAINT production_receipt_keys_no_nulls
 CHECK (array_position("committedDayKeys",NULL) IS NULL);
