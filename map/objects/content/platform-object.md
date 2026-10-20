---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-20 (O1, wa-yvs.1; no role table points at it yet)
entity: packages/core/src/objects-schema.ts:23
---

# platform-object (the one record of a post, comment or group on a platform)

A post, a comment or a group, once per (`platform`, `ref`), whatever table names it. `ref` is the canonical id; every other spelling of it (a raw id, a short URL, LinkedIn's `activity` URN beside its `ugcPost` URN) is an alias that points at it. Designed in `designs/2026-10-20-platform-objects.md`. O1 (bead `wa-yvs.1`) builds the tables, the rules, the write path and the CLI. The tables are empty on prod: no role table writes here and none points here yet (O2 and O3 do both).

## Why this shape

One comment showed twice because Reddit gave `abc` in one read and `t1_abc` in another (migration 0310 fixed the one column). The same split can happen on every column that names a post or comment. So the spelling rules sit in one pure module and every writer goes through one path: `resolveObject` returns the canonical ref, whatever came in. The rules are code, not stored: autobrowse returns raw ids, and wren canonicalises them. Nothing in autobrowse changes when a rule does. A pair no rule joins (a LinkedIn `activity` URN and the `ugcPost` URN for the same post) is joined by hand: `linkRefs` moves every role row to one ref in one transaction.

## Shape

- Tables (`packages/core/src/objects-schema.ts`, migration 0311): `platform_objects` (`:23`, key (`platform`, `ref`); `kind` post|comment|group; `post`, `parent`, `author`, `url`, `at`, `first_seen`, `last_seen`) and `platform_object_refs` (`:50`, key (`platform`, `alias`); `ref` with a foreign key to the object, cascade on update). `platform_objects` is in `AUDIT_SKIPPED` (`packages/db/src/audit/index.ts`): a row per read would flood the log. The alias table stays audited, since an alias is a decision
- Rules (`packages/core/src/objects/canon.ts`, pure, no database): `canonRef` (`:220`, platform, kind, raw spelling to ref; throws `CanonError` for a spelling no rule reads), `fromUrl` (`:239`, the platform and ref a URL carries, else null), `normalUrl` (`:254`, `https://host/path` without query, fragment or trailing slash), `preferRef` (`:269`, which of two refs is kept: LinkedIn's API URN beats the `activity` one, else the first). Reddit comments are `t1_<id>`, posts `t3_<id>`, lowercase. `redditCommentRef` is channel-reddit's `commentRef` (`packages/channel-reddit/src/content.ts`); `bareId` stays there
- Write path (`packages/core/src/objects/index.ts`): `resolveObject` (`:111`) and `resolveObjects` (`:97`, a batch in at most 3 statements per 5,000 items: alias lookup, object upsert, alias insert; a bad spelling in a batch writes nothing). An alias is looked up before the rules read the spelling, so an Instagram shortcode URL stored once resolves later. A second sighting moves `last_seen` and fills only what is empty. `findObject` (`:271`) reads by ref, alias, URL or (with a platform) any spelling the rules read. Every function takes a `Queryable`, so the caller's transaction holds the writes
- Link (`linkRefs`, `:524`): one transaction under `pg_advisory_xact_lock(hashtext('objects:' || platform))`. Reads `OBJECT_ROLES` (`objects/roles.ts:38`). A table with a unique key folds the twin rows (`comments`: the kept row wins and takes the answer; `reach_posts`: the kept row wins; threads and keywords: the dropped one goes); proofs, send attempts, draft picks, draft events and touches of the dropped row move to the kept one (`ITEM_HOMES`, `ROLE_ITEMS`). A table that keeps one row per object and holds both (`reddit_threads.id`, `social_posts.ref`, `social_groups.ref`) refuses: `LinkRefusedError` names both rows and nothing changes. A spelling that already names the same object is a no-op
- Roles: `OBJECT_ROLES` lists every column that names an object. A new column that does goes there. The roles-vs-database test (`packages/core/test/integration/objects.test.ts`) fails when a foreign key to `platform_objects` is not in the list
- CLI (`apps/cli/src/objects.ts`, takes `--client`): `wren objects find <spelling|url> [--platform p] [--json]` prints the object, its aliases and the rows that name it (table, column, ids); `wren objects link <platform> <a> <b>` prints what moved
- Tests: `packages/core/src/objects/canon.test.ts`, `packages/core/test/integration/objects.test.ts`, `apps/cli/src/objects.test.ts`, `apps/cli/test/integration/objects.test.ts`

Citations: `packages/core/src/objects-schema.ts:23`, `packages/core/src/objects/index.ts:524`, `packages/core/src/objects/roles.ts:38`

## Connected to

- **joins:** [[content/comment]] (`comments.ref` twin rule `comment`; `post`, `parent`, `answer_ref` move; `comment:<id>` items and `c:`/`ca:` touches follow a fold)
- **joins:** [[content/reach-post]] (`reach_posts.ref` twin rule `reach`; `onpost:<id>` items and `rp:` touches follow a fold)
- **joins:** [[content/comment-keyword]] (`comment_keywords.post`, and `comment_threads.post` in [[content/comment]]: a twin row is dropped)
- **joins:** [[content/reddit-thread]] (`reddit_threads.id` refuses a link when both rows exist; `target` and `answer_ref` move)
- **joins:** [[research/social-group]] (`social_posts.ref` and `social_groups.ref` refuse a twin; `network` is the platform column)
- **joins:** [[content/draft]] (`content_drafts.published_id` moves) and [[content/draft-event]] (`external_id` moves; `item` moves with a fold)
- **joins:** [[content/comment-proof]] and [[content/send-attempt]] (their `item` key moves from the dropped row's item to the kept one's)
- **joins:** [[content/reach-pass]] (`item` moves with a reach fold) and [[leads/touch]] (`ref` of a comment or reach post moves with a fold)
- **outside the tree:** autobrowse `sites` and `desk` return raw platform ids; they never see a ref. Wren canonicalises on the way in (`resolveObject`), so a change to a platform's id shape in autobrowse means a change to `canon.ts`. Recorded in `effects/CONTEXT.md`
- **looks-like-but-is-not:** [[content/platform]] (the channel adapter that reads and sends; it holds no record of a post) and `content_metrics` (counts per post, no identity)

## If you change this

- **Hits:** every writer of a column in `OBJECT_ROLES` (O2 and O3 move each to `resolveObject`), `channel-reddit` (`commentRef`), the roles-vs-database test, `wren objects`
- **Does not hit:** autobrowse (it returns raw ids as before), the lander, any role table's shape (no foreign key yet, no writer changed in O1)

## Surfaces

| Surface | Role |
|---|---|
| `wren objects find` / `link` | reads / writes |
| role writers (comments, reach posts, reddit threads, social reads, drafts) | none yet (O2, O3) |
| portal | none |

## See

- Source: `packages/core/src/objects-schema.ts`, `packages/core/src/objects/`
- Design: `designs/2026-10-20-platform-objects.md`, brief `designs/briefs/2026-10-20-objects-1-core.md`
