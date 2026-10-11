# Load testing

2026-10-11. William's temp note: "load testing frameworks integration? k6? ... no ambiguity. if
something is slow for like 1000 users, AI can work through it and iterate, and find a solution
that reaches clear success criteria vs guessing at architecture and praying".

## Decision: k6 scenarios on a throwaway stack, one command to a verdict

`pnpm loadtest <scenario>` (`scripts/loadtest.mjs`):

1. Postgres 17 and Restate 1.7.10 in Docker on random ports, Postgres with `fsync=off` and
   `pg_stat_statements`.
2. Every migration, then `loadtest/seeds/<scenario>.sql`: synthetic rows shaped like prod.
3. The worker from source on :19080 with an env built from nothing (`WREN_ENV_FILE=none`): no
   `.env`, no AWS credentials, no webhooks. Nothing can reach prod.
4. k6 runs `loadtest/scenarios/<scenario>.js` against the local ingress. The scenario's
   `thresholds` are the success criteria; any miss exits non-zero.
5. The verdict: one PASS/FAIL line per threshold, CPU of worker, Postgres and Restate, and the
   three statements that took the most database time. JSON in `loadtest/results/` (ignored).

`--up` brings the stack up seeded without k6 (to EXPLAIN or try a fix by hand), `--keep` leaves
it after a run, `--down` clears either. `--vus` sets the peak, `--firms` the seed size.

Why k6: thresholds as code, exit code as verdict, tags per request kind, one binary. Ours stays
the part k6 lacks: a stack that matches prod's code and data shape and says where time went.

## The loop

Run it, read the verdict, change one thing, run it again. Pass = every threshold held. The
profile names the ceiling: whichever of worker, Postgres or Restate is pinned, and which
statement. An agent fixes that, not a guess.

## First scenario: `portal-reads`

The portal's commonest read, `ConsolePortal/recordsList` on `email.firm`: the default view and
its next page, a search, a fifth of calls with facets. 66k firms with prod's ratios of
documents, people and leads (2026-10-11). Peak 100 users. Criteria: errors under 1%, p95 list
500 ms, search 800 ms, facets 1.5 s.

| Run | Req/s | p95 list | Ceiling |
|---|---|---|---|
| Before | 12 | 8.1 s | Postgres: each read aggregated documents, people, leads over every firm |
| Firsts on `companies` (0226) | 28 | 3.9 s | Postgres: search's `ilike '%q%'` over four columns, rows and counts |

Fix 1 (done): `crawled_at`, `named_at`, `lead_at` on `companies`, kept exact per statement by
triggers on the three tables; the view reads them. On prod one count over the view took 170 ms.

Still failing. Next levers, in order:

1. Search: trigram indexes (`pg_trgm`, available on prod, not installed) on the searched
   expressions, or a search column on the view's base. Measure: search rows and count under 10 ms.
2. Counts per page: totals and counts re-run on every page and search. Read-through cache them
   (`designs/2026-10-11-cache.md`) for a few seconds, keyed by type, view and query.
3. The default sort (`added desc` with the text id tiebreak) sorts every firm: an index the
   ORDER BY can use.

Prod has fewer cores than this Mac, so a pass here is the floor, not the proof.
