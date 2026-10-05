# Database audit

Living doc. Started 2026-10-03 from a read-only pass over prod. Revise in place and log changes at the bottom.

## Why

The direction plan named one missing index. William asked for a full pass first: indexes, keys, normalization, foreign keys, partitioning. The console reads these tables next, so fix them before building on them.

## What prod shows

Postgres 17 in Docker on the pg box (t4g.small, 2 GB RAM, 20 GB data volume). The database is 5.35 GB. Cache hit ratio is 93.8%. No table lacks a primary key.

| Finding | Evidence | Cost |
|---|---|---|
| verifications is searched by email domain with no index | 772,646 full scans, 14 billion rows read. `domainKnowledge` runs once per domain in the resolution walk | The resolution queue (2,007 firms) crawls |
| 44 foreign keys have no index | Biggest: `contact_candidates.lead_id` (112k rows, queried by lead in verification and provenance), `sightings.import_id` (319k), `leads.company_id` (43k) | Each lookup or parent delete scans the child table. contact_candidates: 29,002 scans, 10 billion rows read |
| documents holds 3.7 GB of dead space | Heap 66 MB, TOAST 4,133 MB, live rows about 400 MB. Page HTML moves to S3 a day after the crawl (`research/pages.ts`), and the space it left stays in the file | 70% of the database |
| contact_candidates is 90% bloat | 17 MB of live rows in 109 MB of heap and 91 MB of indexes. 564k inserts and 452k deletes for 112k live rows | Every scan reads 10x the data |
| One redundant index | `ix_contact_candidates_person_id` is a prefix of `uq_contact_candidates_person_id` (person_id, email) | 11 MB, and a write on every churned row |
| One reference has no foreign key | `sms_contacts.source_document_id` points at documents.id | A deleted page leaves a dangling id |
| Planner settings assume a bigger, slower box | `effective_cache_size` 4 GB on a 2 GB box. `random_page_cost` 4, the spinning-disk default, on gp3 SSD | The planner favors full scans |
| No query statistics | `pg_stat_statements` is not loaded | Index and cache decisions are guesses |

Checked and fine:

- Other `*_id` columns without a foreign key hold outside ids: Gmail, Meta, SMS provider, trace ids, better-auth. `offer_id` points at offers, which are code in `packages/offers`, not a table.
- Natural keys are unique where they should be: `companies.domain`, `companies.source_key`, `leads.email`, `people.source_key`, `enrichments.document_id`.
- Full scans on messages (2,170 rows), enrollments (1,085), inbox_syncs and thread_events are the planner's right call for tables that small.
- Indexes never used are all under 5 MB, and most are foreign key indexes kept for parent deletes.

## Scope

### Now: migration 0056

1. Expression index on the verification's domain: `ix_verifications_email_domain` on `split_part(email, '@', 2)`. It matches the expression the queries already use, so no query changes.
2. An index on every foreign key column that lacks one, 44 in all, named `ix_<table>_<column>`. Most tables are empty or small. The largest is sightings at 319k rows, about 7 MB.
3. Drop `ix_contact_candidates_person_id`.
4. Foreign key `sms_contacts.source_document_id` to `documents.id`, `on delete set null`. The table is empty on prod.
5. `CREATE EXTENSION IF NOT EXISTS pg_stat_statements`.
6. A schema test in `packages/db` against the test container: every foreign key has an index that leads with its column, and no plain index is a prefix of another on the same table. A new table can't regress either rule.

Indexes go in the Drizzle schema files next to their tables, then `pnpm --filter @wren/db generate`. Drizzle runs pending migrations in one transaction, so `CREATE INDEX CONCURRENTLY` is out. Plain `CREATE INDEX` blocks writes to one table for a few seconds at these sizes, which is fine.

### Now: one-off on prod, by hand

Done once, after the migration deploys. The SQL lives in `deploy/pg-settings.sql`.

1. `VACUUM FULL` documents and contact_candidates, then `ANALYZE`, with `lock_timeout` set so a long query can't stall it. This frees about 3.8 GB, taking the database from 5.35 GB to about 1.5 GB. Each table is locked for seconds while it is rewritten, and Restate retries anything that waits.
2. `ALTER SYSTEM` sets `random_page_cost = 1.1`, `effective_cache_size = 1GB`, `shared_preload_libraries = pg_stat_statements` and `jit = off`. These live in the data volume, so they survive a box rebuild. The box's `-c` flags in `user-data.sh` stay as they are, because editing user data stops the instance.
3. Restart the `wren-pg` container once through SSM for the preload. That means about 5 seconds down, and Restate retries.

Cost: none. The data volume is a fixed 20 GB ($1.60/mo) whatever it holds, nightly dumps skip dead space, and the new indexes total about 15 MB.

### Later, with triggers

| Item | Do it when |
|---|---|
| Partitioning | A table passes about 10 million rows, or needs time-based retention. Candidates then are audit_events, run_events and sightings by month. The biggest table today has 319k rows |
| contact_candidates churn | Bloat passes 2x again after the one-off rewrite. The cause is minting by delete and insert. An upsert would stop it |
| Indexes for the console | `pg_stat_statements` shows a console query in the top ten by total time |
| A stored domain column on verifications | A third query needs the domain. Until then the expression index covers it |

## Done when

- Migration 0056 is on prod and `pg_indexes` shows the new indexes.
- The schema test passes in gates.
- A day later, rows read by full scans of verifications and contact_candidates (`seq_tup_read`) grow at least ten times slower per day, and `pg_database_size` is under 2 GB.

## Decision log

- 2026-10-03: audit run on prod. Foreign key indexing is now a rule enforced by a test, not a case-by-case call. Partitioning was skipped, since no table is near the size where it pays. pg_stat_statements moved up from Next in the direction plan, because it needs the same restart.
- 2026-10-03: 0056 built. The prefix test found three more plain indexes under a unique one: enrichments company_id and document_id, messages enrollment_id. Dropped with the first. 46 indexes added: the 44 foreign keys, the domain, and the new sms_contacts foreign key.
- 2026-10-03: one-off run on prod. VACUUM FULL took 33s on documents and under 1s on contact_candidates. The database went from 5.35 GB to 1.19 GB, and the data volume from 6.5 GB to 2.5 GB used. Settings are live after one restart. JIT was turned off as well: it added about 1s to each console view (pipeline_leaks 1.58s to 0.56s). Scan baseline at 22:06Z: verifications seq_tup_read 13,978,894,821; contact_candidates 10,037,528,472.
- 2026-10-04: done-when check passed at 22:00Z. The overnight jump (2.5 billion verification rows) was the new `lead_sheet` view, fixed by 0065. From 05:57Z to 21:58Z, full scans read 3.6M rows/h on verifications and 2.6M/h on contact_candidates. Counters run from the 09-19 cutover, so the old rate was about 960M and 690M rows a day: both are now about 11x slower. Database 1.30 GB. Top query by total time is the resolution tick (3.2s × 293 calls, about 16 min a day). The firm list averaged 21s before 0069 and now takes 0.2s.
- 2026-10-04: query pass (6e310a9). All prod query time was about 35 min a day. The resolution tick was 3.2s × 296: anti-joins on CTE aggregates were estimated at one row and ran as nested loops. Now it computes domain facts once and checks each candidate with NOT EXISTS on indexed tables: 0.45s, with the same domains returned on prod for every niche. Records stats cast each date to text and back 16 times per row; branching on the column type took the firm list's stats from 1.1s to 0.15s. Left alone: the compose selector (0.6s × 183, about 2 min a day, needs every row for its own ordering) and the lead verification selector (0.17-0.34s, cheap lookups per lead). Every view was timed reading all rows. agency_facts (9s), lead_sheet (6s) and firm_facts (4s) are slow only on full reads, which happen only ad hoc; the app reads them by id in under 1 ms. Indexes: big tables are read almost only by index. The 142 unused indexes total 23 MB and stay, per the foreign key rule. Redis and Elasticsearch: no. Nothing here is a cache miss, and search is ilike over at most about 110k rows. Add pg_trgm GIN indexes if search gets slow. Elasticsearch would need a 1-2 GB JVM (about $15-30 a month for its own box) and a sync pipeline.
- 2026-10-05: UI caching, asked again ("unsure if we need Redis to be future proof"). Measured: a warm records list through Restate Cloud and Lambda takes 0.3s end to end, and the database's share is a few ms to 0.2s. The 21s mean on the Firms "crawled, not named" tab was an old plan; it runs in 0.2s now. Redis would cut milliseconds. The cost was refetching on every visit, so `useLoad` (and the portal's `useCall` on top of it) now keeps the last 200 answers per workspace in the tab and draws a page seen before at once, then refreshes it. Redis stays on the direction doc's triggers: a hot read an index can't fix, or a rate limit shared by two processes. Next speed win is the hop count (Restate self-host R2-R5), not a cache.
