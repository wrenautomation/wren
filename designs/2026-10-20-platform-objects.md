# Platform objects

2026-10-20. William saw each Reddit reply twice, then asked: "i thought we would have had one ids or central tables for each platform posts from there, etc. and then joined with tables". Then: "do it right now".

## Today

- `comments` is one table for every platform and both readers, unique (platform, ref). It broke because two readers spelled one Reddit id two ways (`abc`, `t1_abc`). Fixed for Reddit comments only (ee322f70, migration 0310, `ck_comments_reddit_ref`).
- Posts have no central table. One post can sit in several role tables, each with its own spelling:

| Table | Holds | Post column | Spelling seen on prod |
|---|---|---|---|
| `content_drafts` | our posts | `published_id` | Reddit bare `1abc`; LinkedIn `urn:li:share` / `urn:li:ugcPost` |
| `draft_events` | publish and edit events | `external_id` | Reddit `t3_` and bare mixed; LinkedIn `activity`, `share`, `ugcPost` |
| `comments` | comments, as events | `post`, `parent`, `ref` | Reddit post `t3_` and bare mixed |
| `comment_threads` | posts we commented on, watched | `post` | `t3_` |
| `reddit_threads` | Reddit posts we may answer | `id` | `t3_`; 3 of them are our own posts, bare in `content_drafts` |
| `reach_posts` | LinkedIn posts we may comment on | `ref` | `urn:li:activity`, `urn:li:ugcPost` |
| `social_posts`, `social_groups` | Facebook group posts | `ref` | numeric |
| `social_activity` | likes, mentions on us | `ref` | mixed |
| `keyword_hits`, `comment_keywords` | keyword replies | `ref`, `post` | as `comments` |
| `touches` | person timeline | `external_id`, `url` | per source |

- LinkedIn names one post by two URNs: `urn:li:activity:N` (feed, URLs) and `urn:li:share:M` or `urn:li:ugcPost:M` (API). No offline rule maps one to the other.
- People already have one identity system: `profiles` and `profile_keys`. Out of scope here.

## Target

One row per thing on a platform. Every table that names a post or comment points at that row.

- **`platform_objects`**: `platform`, `ref` (the canonical spelling), `kind` (post, comment, group; information only), `url`, `post` (root post ref, for a comment), `parent` (parent ref), `author`, `at`, `first_seen`, `last_seen`. Primary key (platform, ref).
- **`platform_object_refs`**: every other spelling seen: (platform, alias) primary key → (platform, ref). A bare id, a URL, a LinkedIn activity URN. A lookup by any spelling finds one object.
- **Role tables keep their columns and gain a composite foreign key** (platform, ref-column) → `platform_objects` (platform, ref), `ON UPDATE CASCADE`. A writer that keeps a non-canonical spelling fails at insert. Reads and joins stay as they are. Nothing reads through an extra join.
- **One canonical spelling per platform**, in each channel package: `canon.ts` with `postRef(raw)`, `commentRef(raw)`, `fromUrl(url)`. Reddit: `t3_` and `t1_` fullnames. LinkedIn: the API URN (`share` / `ugcPost`) when known, else the activity URN until a link is learned; then the object's `ref` changes and the cascade carries it. Others: the API id. Registered in one registry in `@wren/core` (`canonRef(platform, kind, raw)`).
- **One write path**: `resolveObject(db, {platform, kind, raw, url?, post?, parent?, author?, at?})` in `@wren/core`: canonicalise, look up aliases, upsert the object (`ON CONFLICT DO UPDATE last_seen`), keep the raw spelling and URL as aliases, return the canonical ref. Race safe. Every reader calls it before it writes a role row. `linkRefs(db, platform, a, b)` records that two spellings are one object; if both are objects already, it merges them: role rows of the dropped one move to the kept one (role twins fold the way 0310 did), then the dropped object becomes an alias.
- **Client databases** get the same tables; each client's readers write their own.

Why composite natural keys and not a surrogate `object_id`: platform refs are stable external ids, already in every role table and every query. A foreign key on them gives the same guarantee (one spelling, one object) with no read-path change. A surrogate id would add a join to every read and a second id to every row.

## What it fixes

- A post or comment kept twice under two spellings (the Reddit bug class, LinkedIn activity vs share).
- "Everything about this post" is one key: our draft, its metrics, its comments, the threads we watch, keyword hits, touches.
- A URL William pastes or opens resolves to the object (`fromUrl` plus aliases).

## Migration

One migration per role table group, each: create objects from the rows (canonical spelling), keep raw spellings as aliases, rewrite the role column to canonical, fold role twins (keep the row with the most state, carry answers, proofs, send records, touches), add the foreign key. LinkedIn activity and share pairs known today (same draft in `draft_events` under both) become aliases first. Dry run each on prod in a rolled-back transaction before push.

## Not in scope

- People (`profiles`, `profile_keys`). `platform_objects.author` stays the platform handle or id.
- autobrowse. It returns raw ids; wren canonicalises at the seam.
- UI. Links already come from `url`.

## Decisions

- 2026-10-20 William: build now, not in the redesign.
- 2026-10-20 Composite natural foreign keys, not surrogate ids (above).
- 2026-10-20 LinkedIn canonical is the API URN once known; the activity URN is then an alias.
