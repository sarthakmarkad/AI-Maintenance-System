-- Run as migration owner after migrate. Create the runtime LOGIN separately,
-- using a private password. Pass: psql "$DIRECT_URL" -v runtime_role=... -f ...
REVOKE ALL ON SCHEMA maintenance FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA maintenance FROM PUBLIC;
GRANT USAGE ON SCHEMA maintenance TO :"runtime_role";
GRANT SELECT ON ALL TABLES IN SCHEMA maintenance TO :"runtime_role";
-- M1 exposes only reads. Future modules require explicit narrow mutation grants.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA maintenance FROM :"runtime_role";
