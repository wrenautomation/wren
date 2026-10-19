---
type: object
cluster: research
universe: live
status: verified
verified: 2026-10-18 @ 2865fb72
entity: packages/research/src/schema.ts:89
---

# fetch-tier

The fetch ladder's memory: per domain, what the render pass learned. Table `fetch_tiers`, on main only.

## Why this shape

A domain is the same fact for every client, so one row per domain on main, never per client. `tier` is `browser` (the box renderer got a page), `impersonate`, `render` or `exit` (the ladder got one at that rung), or `dead` (nothing worked). `block` is the signal that sent the domain to the render pass. A row older than `FETCH_TIER_DAYS` (30) is ignored, so a site that dropped its wall is found again. `learned_at` moves only when the tier changes (`shouldWrite`, `packages/research/src/fetch/tier-memory.ts:55`): if a repeat moved it, a domain we meet often would never go stale.

Two readers. The crawl skips a domain with a row: `dead` and fresh gives a tombstone and no fetch; a ladder tier gives a tombstone `remembered` for the render pass; `browser` is fetched as today, so its shell goes to the box renderer, not the capped ladder. The render pass starts a remembered domain at its rung when that rung is a ladder one, else at `impersonate`, and leaves `dead` domains out of its selection. Only the render pass writes, so the crawl hot path pays one read per company and nothing else.

## Shape

- `domain` (primary key: lowercase hostname, no leading `www.`), `tier`, `block`, `learned_at` (`packages/research/src/schema.ts:89`)
- Not audited (`AUDIT_SKIPPED`): a cache with its own time

Citations: `packages/research/src/schema.ts:89`, `packages/research/src/fetch/tier-memory.ts:60`

## Connected to

- **owned-by:** [[research/document]] (the render pass learns from its documents' fetches; `fetch_tier`, `block_reason` and `fetch_steps` record each one)
- **looks-like-but-is-not:** `documents.fetch_tier` (what answered one page; this is what to do with the next company on the domain)

## If you change this

- **Hits:** `crawlCompany` (`packages/research/src/enrichment/crawler.ts:214`); `climbCompany`, `renderCompany` and `selectRenderTargets` (`packages/research/src/enrichment/render.ts:363`, `:258`, `:535`); the `Enrichment.crawl` and `Enrichment.render` handlers (`packages/research/src/restate/enrichment.ts:671`)
- **Does not hit:** a client's database (main only); `/read` and studies (they never look at it)

## Surfaces

| Surface | Role |
|---|---|
| `Enrichment.crawl` | reads |
| `Enrichment.render` | reads and writes |

## See

- Source: `packages/research/src/fetch/tier-memory.ts`
- Why: `designs/2026-10-18-fetch-ladder.md`
