---
type: object
cluster: research
universe: live
status: stub
verified:
entity: packages/research/src/social-schema.ts
---

# social-group

A Facebook group a keyword search found, the public posts seen in it, and the searches themselves. Tables `social_searches`, `social_groups`, `social_posts` (migration 0097).

## Why this shape

Every read is kept whole and filtered when used. A search keeps the route's whole answer, which also dates and meters the keyword (`GROUP_SEARCH_BUCKET`, 12 a day, burst 3). A search leaves stubs: a group row and a post row per readable post, so the read queue is the rows with `read_at` null (plus Abouts older than 30 days) and a crash loses nothing. Page reads are metered over `read_at` (`GROUP_READ_BUCKET`, 80 a day, burst 10). A 4xx is kept in `error` with `read_at` set, so it is not asked again before it is due. A post reaches a firm by `link`, `author` or `name` (`POST_MAPPINGS`); the firm gets one `post` finding (`fbgroup:post:<ref>`, via `facebook-group`, confidence .9 / .8 / .5) and the post row keeps `company_id`, `person_id` and `mapped_by`. A post that maps to no firm stays here, where it can be mapped later when the firm arrives.

## Shape

- `social_searches`: `network`, `niche`, `keyword`, `n`, `groups`, `answer` (jsonb), `searched_at`
- `social_groups`: unique `(network, ref)`, `niche`, `keyword` (first finder), `name`, `url`, `about` (jsonb), `hit` (jsonb, last), `error`, `read_at`
- `social_posts`: unique `(network, ref)`, `group_id`, `author`, `posted` (as shown, never parsed), `text`, `raw` (jsonb: `hit`, `post`, `comments`), `company_id`, `person_id`, `mapped_by`, `error`, `read_at`

Citations: `packages/research/src/social-schema.ts`, `packages/research/src/enrichment/fb-groups.ts`

## Connected to

- **owns:** the group and post rows
- **joins:** [[leads/company]] and [[leads/person]] (a mapped post), `findings` (the `post` finding)
- **looks-like-but-is-not:** `ad_library` imports (a firm that pays for ads), which add firms; groups add evidence to firms already held

## If you change this

- **Hits:** `fb-groups.ts`, `Enrichment.fbGroups`, the pool's `fbGroups` stage, `postFacts` (a group post under 90 days can feed `post.*` facts only if it carries `published_at`; it carries none)
- **Does not hit:** compose, Resolution

## Surfaces

| Surface | Role |
|---|---|
| `PoolScheduler/{niche}` stage `fbGroups` | writes, Wren's niches with `groupKeywords` |
| `Enrichment/<niche>/fbGroups {"limit": n}` | by hand |
| autobrowse `fb-public` `/groups` routes | read, on the Mac's desk |

## See

- Process: [[processes/pool-feed]]
- Design: `designs/2026-10-05-social-reads.md`
