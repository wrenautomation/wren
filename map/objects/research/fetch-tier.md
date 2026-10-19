---
type: object
cluster: research
universe: live
status: verified
verified: 2026-10-18 @ a3ca7639
entity: packages/research/src/schema.ts:85
---

# fetch-tier

The fetch ladder's memory: per domain, the lowest rung that got a page, so the next fetch starts there. Table `fetch_tiers`, on main only.

## Why this shape

A domain is the same fact for every client, so one row per domain on main, never per client. The row keeps the lowest rung that worked (`impersonate`, `render` or `exit`; `plain` is never stored) and the block that made fetches climb. A row older than `FETCH_TIER_DAYS` (30) is ignored, so a site that dropped its wall is found again. A success at the same rung never moves `learned_at`: if it did, a domain we fetch often would never go stale. A higher rung moves the row up; `plain` over a stale row deletes it; `plain` with no row writes nothing, so most domains never get a row. `learning` (`packages/research/src/fetch/tier-memory.ts:49`) is the pure rule; `tierMemory` (`:62`) applies it to the table.

## Shape

- `domain` (primary key: lowercase hostname, no leading `www.`), `tier`, `block`, `learned_at` (`packages/research/src/schema.ts:85`)
- Not audited (`AUDIT_SKIPPED`): a cache with its own time

Citations: `packages/research/src/schema.ts:85`, `packages/research/src/fetch/tier-memory.ts:19`

## Connected to

- **owned-by:** [[research/document]] (its fetches teach it; `fetch_tier` and `fetch_steps` record each one)
- **looks-like-but-is-not:** `documents.fetch_tier` (what answered one page; this is where to start the next)

## If you change this

- **Hits:** `LadderFetcher` (`packages/research/src/fetch/ladder.ts:44`); `scope().fetch` in `makeEnrichment` (`packages/research/src/restate/enrichment.ts:563`)
- **Does not hit:** a client's database (main only); `/read` and studies (they start at `plain`)

## Surfaces

| Surface | Role |
|---|---|
| `Enrichment.crawl` (through `LadderFetcher`) | reads and writes |

## See

- Source: `packages/research/src/fetch/tier-memory.ts`
- Why: `designs/2026-10-18-fetch-ladder.md`
