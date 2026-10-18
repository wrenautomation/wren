# UI workbench and fast CI

2026-10-17. William: "i want all of those. do both dont stop until both done."

Two problems. A small UI change costs a whole-monorepo loop. The integration run takes 12–25 min, and most of that is work it already did.

Two build areas, one planner each. A planner runs at most its builder share (A: 2, B: 1), so the Mac never has more than 3.

## A. UI workbench (bead wa-c94)

Goal: an agent tunes one component in about 3 files, without the portal, the backend or the full gate.

### A1. DESIGN.md: one source of truth for the look

- Run `/impeccable document` (Skill `impeccable:impeccable`, sub-command `document`) at the wren root.
- It writes `DESIGN.md` (and its sidecar) from the shipped code: tokens in `packages/ui/src/tailwind.css`, `palette.tsx`, `theme.tsx`, the components.
- Fold in the still-true rules from `designs/2026-10-11-portal-look.md`, `2026-10-11-portal-polish.md`, `2026-10-04-borrowed-ui.md`, `2026-10-03-console-ui.md`. Those files stay as history; `DESIGN.md` wins.
- Add a `PRODUCT.md` only if impeccable asks for one. Mode for the portal: Operate.

### A2. Ladle stories for `@wren/ui`

Replaced by `designs/2026-10-17-storybook-visual-tests.md` (Storybook, story tests).

- Ladle (`@ladle/react`, MIT, Vite-native). No Storybook: heavier, and we need no addons.
- Config in `packages/ui/.ladle/`. Its Vite config uses `@vitejs/plugin-react` and `@tailwindcss/vite`, the same as the portal. Global provider (`.ladle/components.tsx`): theme, `tailwind.css`, a `QueryClient` with fixed data, so `useCall`/`useLoad` components render with no `/api`.
- Stories sit beside the component: `packages/ui/src/<name>.stories.tsx`.
- Each story set has at least: default, empty, loading, error, and worst case (long names, unbreakable emails, huge counts, non-Latin, emoji; the `break-ui` list). Synthetic data only: the repo is public.
- Fixtures in `packages/ui/src/fixtures/`, shared by stories and unit tests. One fixture set, never per-story copies.
- First set, by churn since 10-10: `records`, `list-bar`, `shell`, `action`, `draft`, `table` (`DataTable`, `FactsTable`), `controls`, `edit-form`, `cards`/`card-grid`, `accounts`, `day`, `diff`, charts. Then the portal's marketing pieces (`apps/portal/web/src/modules/marketing/pieces.tsx`, `plan.tsx`, `videos.tsx`) if they render from props; a page that only works with the router and `/api` gets no story.
- Scripts in `packages/ui/package.json`: `stories` (`ladle serve --port 61000`), `stories:build` (`ladle build`). A turbo task `stories:build` with outputs `build/**`, run in `gates.sh lint`, so a broken story fails CI and an unchanged one is a cache hit.
- Biome and typecheck cover `*.stories.tsx`.

### A3. `gates.sh ui`

- A fast mode for UI-only work: Biome on changed files, typecheck of `@wren/ui` and `@wren/portal` only, `vitest related` on the changed files. Under the checks lock like the rest.

### A4. `ui` hub in the map

- `map/` gets a UI hub (read `map/CLAUDE.md`, `_meta/schema.md` for the card type). It routes: portal area → screen file → `@wren/ui` components → their stories → the `DESIGN.md` section.
- `map/_meta/build.sh --check` passes.

### A5. `wren-ui` skill

- `.claude/skills/wren-ui/SKILL.md`, beside the existing `portal` skill (read it; merge or link, never two that overlap).
- The loop: read `DESIGN.md` → find the component in the `ui` hub → `pnpm --filter @wren/ui stories` → open `http://localhost:61000/?story=<id>` → edit → screenshot → `vitest run <file>` → `gates.sh ui`. Full gate only at hand-off. Stop Ladle before the report.
- Says when to use `/impeccable live` (pick an element in the real portal), and when an HTML playground is fine (a new direction before any build, thrown away after).
- Token-lean: under 80 lines.

## B. Fast CI (bead wa-0vj)

Measured on run for 91903b9b (a `.gitignore`-only commit): integration 12m31s, 23 of 26 packages a cache miss. `core` 453 s, `channel-email` 345 s, three more 135–183 s. `ci.yml` is 1–5 min and stays as is.

### B1. Make the cache hit

- Find why a `.gitignore` commit misses 23 of 26 (`turbo run test:integration --dry=json` on two shas, diff the hashes). Two suspects:
  - `actions/cache` saves only on a green job. A red or cancelled run saves nothing, so the next run restores an older cache. Fix: `actions/cache/restore` + `actions/cache/save` with `if: always()`; turbo writes only tasks that passed.
  - The task hash takes in files it does not need (root files, `.gitignore`, test fixtures of other packages). Fix: `inputs` and `globalDependencies` in `turbo.json`.
- Done when: a docs-only commit on top of a green run gives 26/26 cache hits.
- Turbo's cache is the one skip mechanism. No second one (`--affected`, path filters) unless B1 cannot make the cache hit.

### B2. One Postgres per run, a template database per file

- Today `startTestPostgres()` (`packages/db/src/testing.ts`) starts one container and runs every migration, once per test file: ~290 starts per full run.
- New: one container per package run, from a vitest `globalSetup` shared from `@wren/db` (`@wren/db/testing/global-setup`). It migrates once into a `wren_template` database, then closes every connection to it.
- `startTestPostgres()` keeps its signature. It makes `CREATE DATABASE t_<random> TEMPLATE wren_template` and returns a handle; `stop()` drops it. Callers do not change.
- Raise `max_connections` for the container to fit `maxWorkers` × pool size.
- Tests that need their own container (Restate, odd extensions) keep a way to ask for one. Find them first.
- Each package's `vitest.config.ts` uses one shared config from `@wren/db` (or a root helper). No per-package copies.
- Then raise `--maxWorkers` and turbo's integration concurrency to what the runner and the Mac hold. The Mac's 16 GB stays the limit: measure peak memory of a full local run; `gates.sh` keeps its lock.

### B3. Shard the run

- If B2 leaves the cold run over 5 min: a matrix in `integration.yml`, N jobs, each `vitest --shard=i/N` per package or a package group by measured time. The repo is public, so runners are free.
- Each shard saves its own turbo cache key.

### B4. Shared remote cache (Mac + CI)

- Self-hosted `ducktors/turborepo-remote-cache` (MIT), S3 storage in a new private bucket with a 30-day expiry.
- Where it runs: read `deploy/README.md` and `docs/restate-operations.md`. The box is a t4g.small: measure free memory first. A Lambda (the project ships a serverless mode) is fine too. Pick the one that costs least; spend over $1/mo is William's call, stop and report.
- Token in SSM `/wren/prod/env-2` (JSON; read `ssm-env-cap` rules in the deploy docs). `TURBO_API`, `TURBO_TEAM`, `TURBO_TOKEN` in CI secrets and the Mac's env through `secrets.mjs`, never printed.
- Cache artifacts hold only public repo code and logs; no step writes secrets into a task output.
- If the remote cache is down, turbo falls back to local; a gate never fails on the cache.

### Done for B

- Cold full integration (cache off) under 5 min in CI.
- A one-package change runs only that package and its dependents.
- Local `gates.sh integration` no slower than today, peak memory under 10 GB.

## Order and hand-off

- A and B run side by side. They touch different files, except `gates.sh` and `turbo.json`: B owns `turbo.json` integration keys, A adds the `stories:build` task and `ui` mode. Rebase on the other's commits; never overwrite.
- Builders work in `~/worktrees/wren-<name>`, commit only their paths, never push.
- Each planner reviews diffs, runs the full gate once, and reports shas. The main session pushes with `scripts/push.sh`.

## Decision log

- Impeccable covers the design language (`document`, `live`). No custom design skill; `wren-ui` is only the wren-specific loop.
- Ladle over HTML playgrounds for tuning: a playground copies the component and drifts. Playgrounds stay for new directions only.
- Ladle over Storybook: lighter, Vite-native, no addons needed.
- Turbo cache over `--affected`: one skip mechanism; it already works for `ci.yml`.
