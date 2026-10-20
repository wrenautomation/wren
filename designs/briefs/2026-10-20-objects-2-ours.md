# Brief O2: platform objects, our posts and comments

Design: `designs/2026-10-20-platform-objects.md` and its 2026-10-20 "Decisions". Bead `wa-yvs.2`. Worktree `~/worktrees/wren-objects-ours`, branch `objects-ours`, from branch `objects-core` (O1's commit). Brief O3 (the reach side) runs beside you in another worktree. Read first: O1's `packages/core/src/objects/` and `objects-schema.ts`, `packages/db/drizzle/0310_reddit_comment_ref.sql`, cards `map/objects/content/comment.md`, `map/objects/content/draft.md`, `map/objects/content/platform-object.md`.

## Goal

Every row that names one of our posts, or a comment on a post, names a `platform_objects` row by foreign key. Reddit post ids are `t3_` everywhere. Migration 0312.

## Role columns (yours)

| Table | Columns | Kind |
|---|---|---|
| `content_drafts` (`packages/content/src/schema.ts`) | (`platform`, `published_id`) | post |
| `draft_events` (`packages/core/src/schema.ts`) | (`platform`, `external_id`) | post for draft kinds `post`, `video`, `post_comment` (its id is the post we commented on); comment for `thread`, `comment` |
| `comments` (`packages/outreach/src/schema.ts`) | (`platform`, `ref`), (`platform`, `post`), (`platform`, `parent`), (`platform`, `answer_ref`) | comment; post; comment, or post when it equals `post`; comment |
| `comment_threads` | (`platform`, `post`) | post |
| `comment_keywords` (`packages/content/src/schema.ts`) | (`platform`, `post`) | post |

Each a composite foreign key to `platform_objects` (`platform`, `ref`), `ON UPDATE CASCADE`, declared in drizzle (`foreignKey(...).onUpdate("cascade")`, importing from `@wren/core/objects-schema`), with an index on the pair where none exists (the schema test wants every FK column indexed). Nullable columns stay nullable (MATCH SIMPLE). Widen a column if the cascade could write a longer ref into it.

Not yours: `reddit_threads`, `reach_posts`, `social_posts`, `social_groups` (O3). `touches`, `social_activity`, `keyword_hits` get no key (Decisions).

## Do

1. **Writers** call `resolveObject` (one row) or `resolveObjects` (many) in the same transaction, before the role write, and write the ref it returns. Found so far; grep for more (`publishedId`, `externalId`, `comments` inserts and `.set(` with `ref`/`post`/`parent`/`answerRef`):
   - `packages/content/src/queue.ts` (`markPublished` and the other `publishedId` writes, the `recordDraft` call), `review.ts`, `train-backfill.ts`.
   - `packages/core/src/draft-record.ts` `recordDraft`: the one writer of `draft_events`. Resolve when `platform` and `externalId` are both set; kind from the draft kind (table above).
   - `packages/content/src/social/store.ts` `keepPostComments` (inserts and the `answerRef` write at ~234) and the other inserts in that file.
   - `packages/outreach/src/comments.ts` `keepComments` (insert at ~125) and the answer writes (~393, ~410).
   - `packages/outreach/src/follow-ups.ts` (comments insert ~477, `comment_threads` insert ~525, the `answerRef` write ~273).
   - `packages/content/src/social/keywords.ts` (`comment_keywords` insert ~57, update ~228).
   - `passes.ts`, `reply-drafts.ts`, `draft-ask.ts`: only where they write a role column of `comments`. O3 edits `reddit_threads` lines in the same files; touch only `comments` lines.
   - `packages/channel-reddit/src/outreach.ts` (~371-383) writes the content row's post bare: write the `t3_` form. `channel-reddit/src/content.ts` publish returns the bare id: leave the adapter, canonicalise at the writer (`resolveObject`).
2. **Readers** of Reddit post ids now see `t3_` where they saw bare: `content/src/metrics.ts`, `restate/metrics.ts`, `restate/desk.ts`, `social/store.ts` `recentPosts` (joins `comments.post = published_id`), `analytics/variants.ts`, `analytics/store.ts`, `analytics/records.ts`, `social/records.ts`, `core/src/sent-url.ts`, `core/src/touch-link.ts`, `content/src/proof.ts`, every URL builder from a published id. Check each one with a `t3_` id; fix the ones that break (the Reddit adapter takes either form through `bareId`).
3. **Migration 0312** `cd packages/db && pnpm -s generate --name our_platform_objects`, then put the data steps before drizzle's `ADD CONSTRAINT` lines, statements split by `--> statement-breakpoint`, a comment at the top as 0310 has:
   1. Reddit: `content_drafts.published_id`, `draft_events.external_id` (post kinds), `comments.post`, and `comments.parent` where it equals `post`: bare to `t3_`.
   2. Insert one object per distinct (platform, ref) in each role column, with its kind, `url` (from `content_drafts.url`, `comments.url` if any), `post`, `parent`, `author`, `at` where the table has them. `ON CONFLICT DO NOTHING`. Comments before posts is fine: no key between objects.
   3. Aliases: each Reddit bare spelling that was rewritten (bare post id to its `t3_` ref), and each draft URL normalised as `normalUrl` does.
   4. Twins: after step 1 no `comments` (`platform`, `ref`) twin exists (0310 folded Reddit; check other platforms on prod and fold as 0310 if any appear). Same for `comment_threads` and `comment_keywords` unique keys.
   5. Drop `ck_comments_reddit_ref` (the key replaces it); keep the rule in `canonRef`.
   The SQL must run on an empty database (tests, new clients) and on prod. It runs on every client database (`packages/db/src/migrate-cli.ts`); a client may hold rows.
4. **Roles**: `OBJECT_ROLES` entries for your columns match the keys you add; the roles test passes.
5. **Fixtures**: integration tests that insert role rows straight into a table now need objects. Seed them with `resolveObjects` (or go through the writer). Grep `packages/*/test` and `apps/*/src/*.test.ts` for inserts into your tables. Fix every one you break; run each changed file with `lockf -s /tmp/wren_automation-checks.lock pnpm -s vitest run <file>` from its package dir.
6. **Map**: cards `comment.md`, `draft.md` (and the `draft_events` card if separate), `platform-object.md` edges; bump `verified`; `map/_meta/build.sh` then `--check`.

## Tests

- Integration: each writer above writes a canonical ref and its object (a bare Reddit id in, `t3_` out; a reply seen first by the reach reader then by the content reader is one row, as 0310's test does). A raw insert with a non-canonical spelling fails on the key.
- The migration: a test that loads pre-0312 shaped rows (bare Reddit post ids in a draft, its events and its comments), runs 0312's SQL (read the file and run its statements, as other migration tests do; grep `drizzle/0` in `packages/*/test`), and checks the rewrite, the objects, the aliases and the keys.
- Synthetic data only.

## Done

Run `./scripts/gates.sh changed` once at the end. Commit in the worktree (own paths only, message as recent ones, ending with the two trailer lines from the planner's prompt). Do not push. Report the sha, what you built, what you skipped, what failed, and every reader you changed.
