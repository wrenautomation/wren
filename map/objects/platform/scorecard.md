---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-18 @ 7b21d8d1
entity: map/_meta/scorecard.mjs:130
---

# scorecard

Backstage's scorecards without Backstage: `map/_meta/build.sh --scorecard` grades each workspace package and each Restate service A to F and prints the worst first. Read only, local, no network.

## Why this shape

One person and agents need drift to show at hand-off, not a portal. The map is the catalog, so the scorecard reads the map, the tests and the component registry. No new app and no table. It never fails the gate until `WREN_SCORECARD_MIN` is set.

## Shape

- Rows: every `packages/*` and `apps/*` with a tracked `package.json`; every service in a component's `provides.services` or `PLATFORM.services` (`scorecard.mjs:84`, `:90`). `apps/worker/src/components.test.ts` holds that list to what the worker binds.
- A service's package is where it is declared: `makeLoopObject("X"`, a `name: "X"` line beside Restate, else a constant (`declared`, `scorecard.mjs:101`). A client's inline `({ name: "X" })` does not count.
- Checks (`·` = does not apply):
  - card: a package holds some card's `entity:`; a service is named in backticks by a card other than [[platform/restate-services]]
  - unit / int: a package has the `test:unit` / `test:integration` script and a file for it (`test/integration/` = int); a service has a test that says `"X"`, or one in its package that imports its declaring file
  - health: a loop service (component `loops`, or `makeLoopObject`; `isLoop` `:118`) is watched by [[platform/loop-watch]]; a deployed app (wrangler or `build:lambda`) has a `/health` route or binds LoopWatch; a package owns a loop
  - owner: [[platform/restate-services]] names the service; `map/effects/CONTEXT.md` routes a change to the package
- Grade by misses (`:178`): 0 A, 1 B, 2 C, 3 D, 4+ F. Flags: `--top=N`, `--min=<grade>` (exit 1 below it, `:192`), `--json`.
- Skipped, said in the output: deploy current (Restate registers a Lambda version, not a commit; its admin API is on the box) and last green gate (no local record).

Citations: `map/_meta/scorecard.mjs:130`, `map/_meta/build.sh:21`, `scripts/gates.sh:23`

## Connected to

- **reads:** every card's `entity:`, [[platform/restate-services]], `map/effects/CONTEXT.md`, each package's `components.ts` and `package.json`, the test files
- **joins:** `scripts/portal-sources.mjs` (`repoFiles`: the same file list as the portal guards)
- **looks-like-but-is-not:** [[platform/checks]] (unit holds at run time), [[platform/loop-watch]] (live loop health)

## If you change this

- **Hits:** `scripts/gates.sh` `map` step (prints the 10 worst rows), the `WREN_SCORECARD_MIN` strict mode
- **Does not hit:** any running service, the database, CI's pass or fail while `WREN_SCORECARD_MIN` is unset

## Surfaces

| Surface | Role |
|---|---|
| `map/_meta/build.sh --scorecard` | prints |
| `scripts/gates.sh` (`map`, `scorecard`) | prints, fails only when strict |

## See

- Source: `map/_meta/scorecard.mjs`
