# Brief O1: platform objects, the primitive

Design: `designs/2026-10-20-platform-objects.md`, all of it, and every 2026-10-20 bullet in its "Decisions". Bead `wa-yvs.1`. Worktree `~/worktrees/wren-objects-core`, branch `objects-core`, from branch `objects` (main plus the design and these briefs). Read first: `map/CLAUDE.md`, card `map/objects/content/comment.md`, `packages/db/drizzle/0310_reddit_comment_ref.sql`, `packages/channel-reddit/src/content.ts` (lines 80-90), `packages/core/src/touch-link.ts`, `packages/core/src/draft-record.ts`, `packages/db/src/audit/index.ts`, `packages/db/drizzle.config.ts`.

Briefs O2 (our posts and comments) and O3 (the reach side) build on this. They add the foreign keys and call your functions from every writer. You add no foreign key to a role table and change no role writer.

## Goal

The two tables, the canon rules, the one write path, the merge, the role list, a CLI. Empty tables on prod after migration 0311.

## Do

1. **Schema** `packages/core/src/objects-schema.ts` (export `./objects-schema` in core's `package.json`; add the path to `packages/db/drizzle.config.ts` beside `touches-schema.ts`):
   - `platform_objects`: `platform` varchar(16) not null, `ref` varchar(255) not null, `kind` varchar(16) not null (`OBJECT_KINDS = ["post", "comment", "group"]`, a check as other tables do with `oneOf`), `url` text, `post` varchar(255) (root post ref, for a comment), `parent` varchar(255), `author` varchar(200), `at` timestamptz, `first_seen` and `last_seen` timestamptz not null default now. Primary key (`platform`, `ref`). Index (`platform`, `post`).
   - `platform_object_refs`: `platform` varchar(16), `alias` text, `ref` varchar(255), `created_at` default now. Primary key (`platform`, `alias`). Foreign key (`platform`, `ref`) to `platform_objects` (`platform`, `ref`) `ON UPDATE CASCADE ON DELETE NO ACTION`, indexed (the schema test wants every FK column indexed).
   - Migration `cd packages/db && pnpm -s generate --name platform_objects` (0311). Tables only, no data.
   - `AUDIT_SKIPPED` gains `platform_objects: "one row per platform post or comment; every sighting rewrites last_seen"`. The aliases stay audited.
2. **Canon** `packages/core/src/objects/canon.ts`. Pure, no DB. One rule set per platform; every platform in core's platform list (grep the `Platform` type) has one. Unknown platform or empty raw throws.
   - `canonRef(platform, kind, raw): string`.
     - reddit: `t3_<id>` for a post, `t1_<id>` for a comment. Takes bare, `t1_`/`t3_`, or a Reddit URL. A raw whose prefix disagrees with `kind` throws (`t1_x` as a post).
     - linkedin posts: `urn:li:share:N`, `urn:li:ugcPost:N`, `urn:li:activity:N` stay as given (no offline map between them). A bare number is refused (it is ambiguous). A feed URL gives its URN; a `/posts/<slug>-activity-<N>-<x>` URL gives the activity URN. linkedin comments: the bare numeric id; `urn:li:comment:(<post urn>,<id>)` gives `<id>`.
     - youtube, x, instagram, facebook, threads, tiktok: the API id, trimmed. URL forms where the URL carries the id (`watch?v=`, `youtu.be/`, `/shorts/`, `x.com|twitter.com/<h>/status/<id>`, tiktok `/video/<id>`). A URL that does not carry the API id (an Instagram `/p/<shortcode>`) throws in `canonRef`; `resolveObject` keeps such a URL as an alias only.
   - `fromUrl(url): { platform, kind, ref } | null`.
   - `normalUrl(url)`: lower-case host, drop `www.`, query (except YouTube `v`), fragment and trailing slash. Aliases keep URLs in this form.
   - `preferRef(platform, a, b)`: which of two spellings is kept on a link. LinkedIn: `share`/`ugcPost` over `activity`. Else `a`.
   - `channel-reddit`: `commentRef` (and the `t3_` form if it has one) now come from core; `content.ts` re-exports `commentRef` so its callers keep working, and `bareId` stays (it is the API call form, not a stored form).
3. **Write path** `packages/core/src/objects/index.ts` (export `./objects`):
   - `resolveObject(db, { platform, kind, raw, url?, post?, parent?, author?, at? }): Promise<string>`. Order: a known alias of `raw` (then of `normalUrl(url)`) wins; else `canonRef`. Upsert the object (`ON CONFLICT (platform, ref) DO UPDATE SET last_seen = now()`, and fill `url`, `post`, `parent`, `author`, `at` only where null). `post` and `parent` are canonicalised too (`post` as a post; `parent` as a comment, or as the post when it equals it). Keep `raw` (when not the ref) and the URL as aliases (`ON CONFLICT DO NOTHING`). Returns the canonical ref. Works inside a caller's transaction (`db` may be a `tx`). Race safe: two concurrent calls for one object end with one row and no error.
   - `resolveObjects(db, items[]): Promise<Map<string, string>>` (raw to ref): the batch form for bulk readers (Reddit discovery keeps thousands). At most three statements per call whatever the count (alias lookup, object upsert, alias insert), chunked under Postgres's parameter limit.
   - `findObject(db, spelling, platform?)`: by ref, alias or URL (`fromUrl`, then `normalUrl` alias). Returns the object row with its aliases, or null.
   - `linkRefs(db, platform, a, b, { by })`: two spellings name one object. Kept ref is `preferRef`. In one transaction under `pg_advisory_xact_lock(hashtext('objects:' || platform))`:
     1. Make sure the kept object exists (copy the dropped object's fields when only the dropped one exists; fill nulls when both exist).
     2. For each role in `OBJECT_ROLES` (step 4): fold twins, then update the role column from the dropped ref to the kept ref.
     3. Repoint the dropped object's aliases to the kept ref, delete the dropped object, keep the dropped ref as an alias.
     This order works with or without the role foreign keys and does not rely on the cascade. Returns what it moved per role table. Linking a spelling to itself or two spellings already one object is a no-op.
4. **Role list** `packages/core/src/objects/roles.ts`: `OBJECT_ROLES`, one entry per role column, plain table and column names (core imports no other package). Fields: `table`, `platform` column (`platform`, or `network` for `social_posts`/`social_groups`), `column`, `kind`, and `twin` for a column in a unique key:
   - `comments.ref` (unique with platform): fold as 0310 does: the kept row wins, carry `answer`, `answer_ref`, `answered_at` and `state = 'answered'` from the dropped row when the kept row is not answered, move `comment_proofs` and `send_attempts` items `comment:<id>` and touches `c:<id>`/`ca:<id>` (and `answers`), then delete the dropped row. Read 0310 and write the same steps in SQL.
   - `comment_threads.post`, `comment_keywords.post` (unique keys): the kept row wins; delete the dropped row.
   - `reach_posts.ref`: the kept row wins; move items `onpost:<id>` wherever they are kept (grep `onpost:` across packages: `comment_proofs`, `send_attempts`, `draft_events.item`, outreach drafts), then delete the dropped row.
   - `reddit_threads.id`, `social_posts.ref`, `social_groups.ref`: `twin: "refuse"`. Reddit canon is fixed, so Reddit never links; Facebook ids are API ids. On a twin `linkRefs` throws naming both rows, and changes nothing.
   - Columns not in a unique key (move only): `content_drafts.published_id`, `draft_events.external_id`, `comments.post`, `comments.parent`, `comments.answer_ref`, `reddit_threads.target`, `reddit_threads.answer_ref`.
   - `reddit_threads` has no `platform` column yet (O3 adds it). Mark the entry `platform: null, fixed: "reddit"` until O3 changes it.
5. **CLI** `apps/cli/src/objects.ts`, wired in `main.ts` like `touches.ts`, with `--client` like the others: `wren objects find <spelling|url> [--platform <p>]` (the object, its aliases, and the role rows that name it: table and id per row) and `wren objects link <platform> <a> <b>` (prints what moved). Tests beside it as `shape.test.ts` is written.
6. **Map**: a new card `map/objects/content/platform-object.md` (template as `comment.md`; edges to every role card; "outside the tree": autobrowse returns raw ids, wren canonicalises). `comment.md` names it. Run `map/_meta/build.sh` then `map/_meta/build.sh --check`.

## Tests

- Unit `packages/core/src/objects/canon.test.ts`: every platform, every URL form above, the refusals, `normalUrl`, `preferRef`.
- Integration `packages/core/test/integration/objects.test.ts` (run from `packages/core` with `lockf -s /tmp/wren_automation-checks.lock pnpm -s vitest run test/integration/objects.test.ts`; Docker `wren-postgres-1` is up):
  - resolve twice gives one row, `last_seen` moves, `first_seen` stays; the raw and URL aliases land; a lookup by alias returns the ref.
  - 20 concurrent `resolveObject` calls for one object: one row, no error.
  - `resolveObjects` with 2,000 items in one call, mixed new and known.
  - `linkRefs` (LinkedIn activity and ugcPost): only the activity object exists (it becomes the ugcPost ref; aliases carried); both exist with a `comments` row each (the twins fold, a proof and a send attempt move to the kept row, the answer carries); a `reach_posts` twin; a `refuse` twin throws and nothing changed; a no-op link.
  - Roles against the database: every foreign key in `pg_constraint` that references `platform_objects` (besides `platform_object_refs`) is in `OBJECT_ROLES`. Today there are none; O2 and O3 add them. O3 turns this into set equality.
- Synthetic data only: no names, handles, amounts or client names.

## Done

Commit in the worktree (own paths only, message as the repo's recent ones, ending with the two trailer lines from the planner's prompt). Do not push. Report the sha, what you built, what you skipped, what failed.
