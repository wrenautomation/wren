---
type: object
cluster: research
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/research/src/schema.ts:31
---

# document

One fetched page or PDF of a company's site, stored with its text and html. Table `documents`. HTML a day old moves to the pages bucket (`PageArchive`); the row keeps `html_key` and its `tel:` targets.

## Why this shape

Everything downstream reads stored pages, never the live web: extraction, email scan, the contacts stage and provenance all cite a `document_id`. `fetch_tier` says how it was got (plain fetch or rendered), `is_shell` marks a page that needs rendering, `robots_disallowed` records that we fetched past a disallow (warn mode). HTML was ~85% of the database and of each nightly dump, read once by the scan, so it lives in S3 once scanned; `htmlOf` reads it from either place, and nothing is dropped.

A client's crawl reads and feeds main through `sharedPages` (`packages/research/src/enrichment/shared-pages.ts`): a 200 under 30 days old for the same URL is served from main, a fresh one is kept on main with `company_id` null. The client's own row is still written in its database. robots.txt always goes to the network.

## Shape

- `company_id`, `url`, `final_url`, `kind` (webpage | pdf), `status_code`, `content_hash`, `title`, `text`, `html` (null once archived), `html_key`, `tel_hrefs`, `fetch_tier`, `is_shell`, `robots_disallowed` (`packages/research/src/schema.ts`)

Citations: `packages/research/src/schema.ts:31`

## Connected to

- **owned-by:** [[leads/company]]
- **owns:** [[research/enrichment]] (`document_id`)
- **owns:** [[research/contact-point]] (`document_id`)
- **joins:** [[sms/sms-contact]] (`source_document_id`), the address provenance on [[email/message]]

## If you change this

- **Hits:** crawler and renderer (`packages/research/src/enrichment/crawler.ts:133`, `render.ts:156`); email scan (`packages/research/src/enrichment/email-scan.ts`); extraction (`packages/research/src/enrichment/extraction.ts`); contacts stage (`packages/research/src/enrichment/contacts.ts:265`); the archive (`packages/research/src/pages.ts`)
- **Does not hit:** discovery (it decides the domain before any page is stored)

## Surfaces

| Surface | Role |
|---|---|
| `Enrichment.crawl`, `Enrichment.render` | write |
| `Enrichment.scan/contacts/extract` | read |
| `PageArchive.loop` (box), `wren pages archive` | moves html to S3 |

## See

- Source: `packages/research/src/enrichment/crawler.ts`
