-- The art worker's role (oplog 0027, ADR-0004 as amended 2026-10-05): pg-boss, the keepsake's
-- id and share token, and its facts. Never add `donation_intents`, `donations` or the rest of
-- `keepsake`: this role runs on a home machine and must never reach a donor's address.
-- Run as the schema owner: psql -v role=<role> -v db=<database> -f scripts/home-worker-grants.sql
GRANT CONNECT ON DATABASE :"db" TO :"role";
GRANT USAGE ON SCHEMA public TO :"role";
GRANT SELECT (id, share_token, snapshotted_at) ON keepsake TO :"role";
GRANT SELECT, INSERT ON keepsake_fact TO :"role";
GRANT USAGE ON SEQUENCE keepsake_fact_id_seq TO :"role";
GRANT USAGE ON SCHEMA pgboss TO :"role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO :"role";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO :"role";
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"role";
