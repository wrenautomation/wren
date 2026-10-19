---
type: object
cluster: research
universe: live
status: verified
verified: 2026-10-18 @ a3ca7639
entity: packages/research/src/schema.ts:41
---

# document

One fetched page or PDF of a company's site, stored with its text and html. Table `documents`. HTML a day old moves to the pages bucket (`PageArchive`); the row keeps `html_key` and its `tel:` targets.

## Why this shape

Everything downstream reads stored pages, never the live web: extraction, email scan, the contacts stage and provenance all cite a `document_id`. `fetch_tier` says how it was got, `block_reason` and `fetch_steps` say what stood in the way, `is_shell` marks a page that needs rendering, `robots_disallowed` records that we fetched past a disallow (warn mode). HTML was ~85% of the database and of each nightly dump, read once by the scan, so it lives in S3 once scanned; `htmlOf` reads it from either place, and nothing is dropped.

`fetch_tier` values: `httpx` (wren's own plain fetch), `browser` (the box render pass), and `impersonate`, `render`, `exit` (the fetch ladder, below). `block_reason` is the block that made the fetch climb, or the one that stopped it (`status-403`, `cloudflare`, `shell`, `cap`, `offline`); `fetch_steps` is every rung tried, `[{ tier, status, block }]`. The homepage tombstone keeps its `status_code` and adds both.

The ladder is `LadderFetcher` (`packages/research/src/fetch/ladder.ts:44`), a `Fetcher` decorator the crawl wraps its fetch in when `makeEnrichment` has a `ladder` site client. It tries wren's plain fetch first. A 403, 429, 503 or a JS shell sends the URL to autobrowse's `web GET /fetch` (impersonate, render, exit on the Mac). A page it brings back carries its tier; a ladder that is capped (429), off or still blocked leaves the plain answer, now with the block and steps. Where to start is the per-domain memory, [[research/fetch-tier]]. `robots.txt` always goes to the plain fetcher.

A client's crawl reads and feeds main through `sharedPages` (`packages/research/src/enrichment/shared-pages.ts`): a 200 under 30 days old for the same URL is served from main (a `httpx` page, or an `impersonate`, `render` or `exit` page that is not a shell, with its tier), a fresh one is kept on main with `company_id` null. The client's own row is still written in its database. robots.txt always goes to the network.

## Shape

- `company_id`, `url`, `final_url`, `kind` (webpage | pdf), `status_code`, `content_hash`, `title`, `text`, `html` (null once archived), `html_key`, `tel_hrefs`, `fetch_tier`, `is_shell`, `robots_disallowed`, `block_reason`, `fetch_steps` (`packages/research/src/schema.ts`)

Citations: `packages/research/src/schema.ts:41`, `packages/research/src/fetch/ladder.ts:44`, `packages/research/src/enrichment/crawler.ts:159`

## Connected to

- **owned-by:** [[leads/company]]
- **owns:** [[research/enrichment]] (`document_id`)
- **owns:** [[research/contact-point]] (`document_id`)
- **owns:** [[research/fetch-tier]] (the per-domain start rung the crawl learns from its documents' fetches)
- **joins:** [[sms/sms-contact]] (`source_document_id`), the address provenance on [[email/message]]

## If you change this

- **Hits:** crawler and renderer (`packages/research/src/enrichment/crawler.ts:159`, `render.ts:156`); email scan (`packages/research/src/enrichment/email-scan.ts`); extraction (`packages/research/src/enrichment/extraction.ts`); contacts stage (`packages/research/src/enrichment/contacts.ts:265`); the archive (`packages/research/src/pages.ts`)
- **Seam:** the ladder's rungs run in autobrowse (`web GET /fetch`, `src/reach/ladder.ts`); tier and block names are its contract (`effects/CONTEXT.md`, outside the tree)
- **Does not hit:** discovery (it decides the domain before any page is stored)

## Surfaces

| Surface | Role |
|---|---|
| `Enrichment.crawl`, `Enrichment.render` | write (`crawl` through `LadderFetcher` when `ladder` is set) |
| `Enrichment.scan/contacts/extract` | read |
| `PageArchive.loop` (box), `wren pages archive` | moves html to S3 |

## See

- Source: `packages/research/src/enrichment/crawler.ts`, `packages/research/src/fetch/ladder.ts`
- Why: `designs/2026-10-18-fetch-ladder.md`
