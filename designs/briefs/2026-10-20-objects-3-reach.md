# Brief O3: platform objects, the reach side

Design: `designs/2026-10-20-platform-objects.md` and its 2026-10-20 "Decisions". Bead `wa-yvs.3`. Worktree `~/worktrees/wren-objects-reach`, branch `objects-reach`, from branch `objects-core` (O1's commit). Brief O2 (our posts and comments) runs beside you and owns migration 0312. Read first: O1's `packages/core/src/objects/` and `objects-schema.ts`, the reach cards in `map/objects/` (grep `reddit_threads`, `reach_posts`, `social_posts`), `map/objects/content/platform-object.md`.

## Goal

Every row that names a post we may answer, or a Facebook group or group post, names a `platform_objects` row by foreign key. Migration 0313.

## Role columns (yours)

| Table | Columns | Kind |
|---|---|---|
| `reddit_threads` (`packages/outreach/src/schema.ts`) | (`platform`, `id`), (`platform`, `target`), (`platform`, `answer_ref`) | post; post (`t3_`) or comment (`t1_`); comment |
| `reach_posts` | (`platform`, `ref`) | post |
| `social_posts` (`packages/research/src/social-schema.ts`) | (`network`, `ref`) | post |
| `social_groups` | (`network`, `ref`) | group |

- `reddit_threads` gains `platform` varchar(16) not null default `'reddit'` with a check `platform = 'reddit'`. A plain column: a generated column cannot take `ON UPDATE CASCADE`. Keep the PK on `id`.
- Each pair a composite foreign key to `platform_objects` (`platform`, `ref`), `ON UPDATE CASCADE`, in drizzle (`foreignKey(...).onUpdate("cascade")`, from `@wren/core/objects-schema`), indexed where no index covers it. Nullable stays nullable. `reach_posts.ref` is varchar(80): widen it to 255, since a learned LinkedIn link cascades into it.

## Do

1. **Writers** call `resolveObject` / `resolveObjects` in the same transaction before the role write, and write the ref returned. Found so far; grep for more:
   - `packages/outreach/src/discovery/threads.ts` (insert ~136: thousands per pass, use `resolveObjects`; `target` ~588; `answerRef` ~679 and the reads after it).
   - `packages/outreach/src/intercept.ts` (`reach_posts` insert ~175, `reddit_threads` insert ~222).
   - `packages/outreach/src/reach-posts.ts` (insert ~755 and any `ref` write).
   - `scheduled.ts`, `requirements.ts`, and in `passes.ts`, `reply-drafts.ts`, `draft-ask.ts` only the `reddit_threads` / `reach_posts` lines (O2 edits `comments` lines in the same files).
   - The send path that writes `reddit_threads.answer_ref` after a post to Reddit: resolve the reply in the same transaction as the ref write, so the key cannot fail after the send.
   - `packages/research/src/enrichment/fb-groups.ts` (`social_groups` ~251, `social_posts` ~275).
2. **Migration 0313**. Do not generate it until the planner sends you a message that O2's commit is on `objects`. Build and test the schema and writers first. Then rebase on `objects`, run `cd packages/db && pnpm -s generate --name reach_platform_objects`, and put the data steps before drizzle's `ADD CONSTRAINT` lines (a comment at the top as 0310 has):
   1. Add `reddit_threads.platform`.
   2. Insert one object per distinct (platform, ref) in each role column with its kind, `url`, `author`, `at` where the table has them, `ON CONFLICT DO NOTHING` (O2's 0312 already made our own Reddit posts; three `reddit_threads` rows are those posts).
   3. Aliases: the normalised URL of each row that has one.
   4. No twins are known (Reddit canon is fixed, LinkedIn links are none today). Check prod before you write it off.
   The SQL must run on an empty database and on prod. It runs on every client database.
3. **Roles**: set `reddit_threads` entries to `platform: "platform"` (drop `fixed`). Turn O1's roles test into set equality: every key to `platform_objects` is in `OBJECT_ROLES`, and every entry has its key.
4. **Fixtures**: seed objects with `resolveObjects` in the integration tests that insert your tables straight (grep `packages/*/test` and `apps/*/src/*.test.ts` for `redditThreads`, `reachPosts`, `socialPosts`, `socialGroups`). Run each changed file with `lockf -s /tmp/wren_automation-checks.lock pnpm -s vitest run <file>` from its package dir.
5. **Map**: the reddit thread, reach post and social post cards, and `platform-object.md` edges; bump `verified`; `map/_meta/build.sh` then `--check`.

## Tests

- Integration: discovery keeps thousands of threads in one pass with three object statements per chunk; intercept and reach-post writers write the object; a reply ref after a send lands with its object; a raw insert with an unknown ref fails on the key.
- The migration: pre-0313 shaped rows in, 0313's SQL run, objects, aliases and keys checked.
- Synthetic data only.

## Done

Run `./scripts/gates.sh changed` once at the end. Commit in the worktree (own paths only, message as recent ones, ending with the two trailer lines from the planner's prompt). Do not push. Report the sha, what you built, what you skipped, what failed.
