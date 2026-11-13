# Portal speed: p50, p90, p99 per route (WA-1344)

William, 11-12: "add some load testing CI or something so i can gain some insights into p99 and p90 data as well. i have a suspicions the graphs are slow and could be optimized, but thats after."

## Goal

William opens one page and sees, per portal route: calls, p50, p90, p99, and whether the time is queue wait or run time. Then the slow routes get profiled and fixed, graphs first.

## What the data already says

`rt.invocations` keeps every call since 11-09 (18,295 rows, 2,565 a caller waited on). Each row has `created_at`, `started_at`, `completed_at`, `caller_waits` and its lane (`build`: an `arn:` is Lambda; `remote` set is a desk call; else the box).

Waited calls, 11-09 to 11-13, run time (start to end):

| Route | Calls | p50 | p90 |
|---|---|---|---|
| ConsolePortal/recordsCounts | 386 | 1121 ms | 1813 ms |
| VariantsConsole/batches | 61 | 505 ms | 3977 ms |
| PipelineConsole/mapRead | 31 | 435 ms | 3880 ms |
| ConsolePortal/recordsList | 478 | 279 ms | 3519 ms |
| CanonConsole/references | 14 | 299 ms | 716 ms |

Before WA-1353 the p90 tail was Lambda cold starts (3–5 s). Since its part A (11-13 08:42Z) every waited call runs on the box. A slow p50 is the route's own work: `recordsCounts` is the first to profile.

## Options

| Option | For | Against |
|---|---|---|
| **A. Speed page from real traffic (picked)** | The numbers people feel, on prod data volumes, with no load sent. Free: one view and one record | Only routes people use show; a quiet route has few calls |
| B. Load test in CI on a synthetic database | Catches a slow query before deploy | A runner's numbers are noisy; synthetic volumes differ from prod; every read route needs valid inputs (158 routes); prod inputs can't go in a public repo |
| C. A synthetic probe against prod routes | Every route, on a schedule | Load on prod for data the real calls already give |

A, then profile the slow routes from it. B waits until a route regresses after a fix; then it gets a test for that route alone.

## Build

1. Runtime migration V10: index `rt.invocations (created_at)`; view `rt_admin.call_speed`, one row per window (day, week), route and lane: calls, p50, p90, p99 of the whole call, p90 of queue wait and of run time, failed count. Only calls a caller waited on.
2. Core: `speedRecord(admin)` (`console.speed`, app office), rows from the view through the admin query, as `console.loop` does. Times are seconds (`duration` fields).
3. Portal: Back office › System › Speed, a list page. Views: Today (24 h), This week. Sorted by p90, slowest first.
4. Profile, slowest p50 first: `recordsCounts`, `batches`, `mapRead`. Each fix gets its before and after in the log below.

## Speed page states

The list template draws them; no new part.

| State | Shows | Next |
|---|---|---|
| Loading | The list's skeleton rows | Typical, Empty, Failed |
| Typical | A row per route and lane; slowest p90 first | Another view (the list's own motion) |
| Empty | "Speed shows here once people use the portal." | Typical |
| Failed | The list's error with Retry | Loading |
| Narrow (390) | The list's phone cards: route, p90, calls | — |

## Not built

- Cold start per call. Since WA-1353 A no waited call runs on Lambda; the Lambda's `lambda ready` log line keeps the init split.
- A retention job for `rt.invocations`. It grows about 4,500 rows a day; the index keeps the page's read small.

## Decision log

- 2026-11-13: real traffic (A), not a CI load test or a prod probe. A CI test comes per route, after a fix, if that route regresses.
- 2026-11-13: lane from `build`: `arn:` Lambda, `worker/` box, else desk (the Mac's desk worker leaves it null). The view covers every waited call, not only portal reads: a slow desk call is a wait too.
- 2026-11-13: `recordsCounts` (the sidebar's counts, each minute) was `list` with limit 1 per ask: an ordered rows query plus every tab's count and totals, for one number. Now `count`: one `count(*)` on the same filters. Before: p50 1121 ms, p90 1813 ms (4 days, 386 calls). After: read it on Speed once a day of traffic is in.
- 2026-11-13: `batches` and `mapRead` wait. Their p90 (about 4 s) was Lambda cold starts, gone since WA-1353 A; profile them from box numbers.
- 2026-11-13: the shared `duration` format shows ms under 1 s and one decimal under 10 s ("279ms", "3.9s"); whole seconds showed every read as "0s".
