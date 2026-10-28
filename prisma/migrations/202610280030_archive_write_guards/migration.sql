CREATE FUNCTION maintenance.check_initial_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='WorkOrder' AND to_jsonb(NEW)->>'status'='CANCELLED' THEN
   RAISE EXCEPTION 'Create work before recording cancellation evidence';
 END IF;
 IF TG_TABLE_NAME='Machine' AND to_jsonb(NEW)->>'archivedAt' IS NOT NULL THEN
   RAISE EXCEPTION 'Register equipment before recording archival evidence';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER initial_lifecycle BEFORE INSERT ON maintenance."WorkOrder" FOR EACH ROW EXECUTE FUNCTION maintenance.check_initial_lifecycle();
CREATE TRIGGER initial_lifecycle BEFORE INSERT ON maintenance."Machine" FOR EACH ROW EXECUTE FUNCTION maintenance.check_initial_lifecycle();

CREATE FUNCTION maintenance.check_archived_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS NOT DISTINCT FROM OLD."archivedAt" AND
   (to_jsonb(NEW)-'version'-'updatedAt') IS DISTINCT FROM (to_jsonb(OLD)-'version'-'updatedAt') THEN
   RAISE EXCEPTION 'Restore the machine before changing its metadata';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER archived_metadata BEFORE UPDATE ON maintenance."Machine" FOR EACH ROW EXECUTE FUNCTION maintenance.check_archived_metadata();
CREATE TRIGGER active_machine_insert BEFORE INSERT ON maintenance."MachinePhoto" FOR EACH ROW EXECUTE FUNCTION maintenance.require_active_machine();
CREATE TRIGGER active_machine_insert BEFORE INSERT ON maintenance."MachineAccess" FOR EACH ROW EXECUTE FUNCTION maintenance.require_active_machine();
CREATE FUNCTION maintenance.require_active_machine_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE archived timestamptz;
BEGIN
 SELECT "archivedAt" INTO archived FROM maintenance."Machine" WHERE id=OLD."machineId" AND "orgId"=OLD."orgId" FOR SHARE;
 IF archived IS NOT NULL THEN RAISE EXCEPTION 'Restore the machine before changing its photo or access'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER active_machine_delete BEFORE DELETE ON maintenance."MachinePhoto" FOR EACH ROW EXECUTE FUNCTION maintenance.require_active_machine_delete();
CREATE TRIGGER active_machine_delete BEFORE DELETE ON maintenance."MachineAccess" FOR EACH ROW EXECUTE FUNCTION maintenance.require_active_machine_delete();
REVOKE ALL ON FUNCTION maintenance.check_initial_lifecycle(),maintenance.check_archived_metadata(),maintenance.require_active_machine_delete() FROM PUBLIC;
