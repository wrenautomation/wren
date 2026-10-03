-- One-off on prod, after migration 0056 deploys. Why: designs/2026-10-03-database-audit.md.
-- Run on the pg box (SSM shell, see README.md):
--   docker exec -i wren-pg psql -U wren -d wren -v ON_ERROR_STOP=1 < pg-settings.sql
-- VACUUM can't run in a transaction, so no BEGIN; psql runs each line on its own.

-- Give up on a lock after 5s instead of queueing behind a long query and stalling everything behind it.
-- If a VACUUM FULL times out, rerun that line.
SET lock_timeout = '5s';
SET statement_timeout = 0;

-- Rewrite the two bloated tables (frees about 3.8 GB). Each is locked for seconds; Restate retries.
VACUUM (FULL, VERBOSE) documents;
VACUUM (FULL, VERBOSE) contact_candidates;
ANALYZE documents;
ANALYZE contact_candidates;

-- Planner settings for a 2 GB box on gp3 SSD, and query stats. Stored in the data volume
-- (postgresql.auto.conf), so they survive a box rebuild. user-data.sh's -c flags set none of these.
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
-- JIT compiles each big query first, which costs about 1s here and never pays back at these sizes.
ALTER SYSTEM SET jit = off;

-- Then restart the container once through SSM (about 5s down; Restate retries):
--   docker restart wren-pg
-- SELECT pg_reload_conf() is not enough: shared_preload_libraries loads only at server start.
-- Check after: SHOW shared_preload_libraries; SELECT count(*) FROM pg_stat_statements;
