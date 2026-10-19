---
type: object
cluster: research
universe: live
status: verified
verified: 2026-10-18 @ 2865fb72
entity: packages/research/src/schema.ts:41
---

# document

One fetched page or PDF of a company's site, stored with its text and html. Table `documents`. HTML a day old moves to the pages bucket (`PageArchive`); the row keeps `html_key` and its `tel:` targets.

## Why this shape

Everything downstream reads stored pages, never the live web: extraction, email scan, the contacts stage and provenance all cite a `document_id`. `fetch_tier` says how it was got, `block_reason` and `fetch_steps` say what stood in the way, `is_shell` marks a page that needs rendering, `robots_disallowed` records that we fetched past a disallow (robots.txt is a warning, never a stop). HTML was ~85% of the database and of each nightly dump, read once by the scan, so it lives in S3 once scanned; `htmlOf` reads it from either place, and nothing is dropped.

`fetch_tier` values: `httpx` (wren's own plain fetch), `browser` (the box render pass), and `impersonate`, `render`, `exit` (the fetch ladder, below). `block_reason` says why the render pass has the company: the crawl's block (`status-403`, `status-429`, `status-503`), `remembered` (the domain's memory sent it) or `dead` (the memory says nothing works). On a ladder page it keeps the block that sent the company; on a ladder tombstone, the block that stopped it (`cloudflare`, `shell`). `fetch_steps` is the ladder's tries for that page, `[{ tier, status, block, ms }]`.

The crawl's hot path is plain: one fetch with `PoliteFetcher`'s retries, no ladder call. A refused homepage leaves a tombstone (`status_code` 403/429/503, `block_reason` `status-<n>`). Before a company's first fetch, `crawlCompany` (`packages/research/src/enrichment/crawler.ts:214`) reads the domain's memory ([[research/fetch-tier]]): `dead` gives a tombstone `dead` (stat `dead_skipped`), any render tier gives a tombstone `remembered` (stat `remembered_skipped`), and neither fetches.

The ladder runs in the render pass. `climbCompany` (`packages/research/src/enrichment/render.ts:363`) takes a company with a blocked tombstone (`status-*` or `remembered`), no rendered document and a domain that is not `dead`. It makes one `web GET /fetch` for the homepage, from the remembered rung or `impersonate`, then fetches the people pages at the rung that answered, and stores them at the ladder's tier. A page learns its rung. No page: the tombstone moves to the last rung tried with the final block and the domain is `dead`. `ladderLimit` (default 40) caps the calls per run. Shells still go to the box renderer.

A client's crawl reads and feeds main through `sharedPages` (`packages/research/src/enrichment/shared-pages.ts`): a 200 under 30 days old for the same URL is served from main (a `httpx` page, or an `impersonate`, `render` or `exit` page that is not a shell, with its tier), a fresh one is kept on main with `company_id` null. The client's own row is still written in its database. robots.txt always goes to the network.

## Shape

- `company_id`, `url`, `final_url`, `kind` (webpage | pdf), `status_code`, `content_hash`, `title`, `text`, `html` (null once archived), `html_key`, `tel_hrefs`, `fetch_tier`, `is_shell`, `robots_disallowed`, `block_reason`, `fetch_steps` (`packages/research/src/schema.ts`)

Citations: `packages/research/src/schema.ts:41`, `packages/research/src/enrichment/crawler.ts:214`, `packages/research/src/enrichment/render.ts:363`, `packages/research/src/fetch/ladder.ts:32`

## Connected to

- **owned-by:** [[leads/company]]
- **owns:** [[research/enrichment]] (`document_id`)
- **owns:** [[research/contact-point]] (`document_id`)
- **owns:** [[research/fetch-tier]] (the per-domain memory the render pass writes and the crawl reads)
- **joins:** [[sms/sms-contact]] (`source_document_id`), the address provenance on [[email/message]]

## If you change this

- **Hits:** crawler and renderer (`packages/research/src/enrichment/crawler.ts:214`, `render.ts:258`, `render.ts:363`); email scan (`packages/research/src/enrichment/email-scan.ts`); extraction (`packages/research/src/enrichment/extraction.ts`); contacts stage (`packages/research/src/enrichment/contacts.ts:265`); the archive (`packages/research/src/pages.ts`)
- **Seam:** `Enrichment.render` calls autobrowse's `web GET /fetch` (`src/reach/ladder.ts`); tier and block names are its contract (`effects/CONTEXT.md`, outside the tree)
- **Does not hit:** discovery (it decides the domain before any page is stored)

## Surfaces

| Surface | Role |
|---|---|
| `Enrichment.crawl` | write; reads the memory, skips `dead` and remembered domains |
| `Enrichment.render` | write; shells through the box browser, blocked companies through `web GET /fetch` (`ladder` dep, `ladderLimit`) |
| `Enrichment.scan/contacts/extract` | read |
| `PageArchive.loop` (box), `wren pages archive` | moves html to S3 |

## See

- Source: `packages/research/src/enrichment/crawler.ts`, `packages/research/src/enrichment/render.ts`, `packages/research/src/fetch/ladder.ts`
- Why: `designs/2026-10-18-fetch-ladder.md`
