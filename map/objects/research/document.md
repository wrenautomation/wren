---
type: object
cluster: research
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/research/src/schema.ts:31
---

# document

One fetched page or PDF of a company's site, stored with its text and html. Table `documents`.

## Why this shape

Everything downstream reads stored pages, never the live web: extraction, email scan, phone lift and provenance all cite a `document_id`. `fetch_tier` says how it was got (plain fetch or rendered), `is_shell` marks a page that needs rendering, `robots_disallowed` records that we fetched past a disallow (warn mode).

## Shape

- `company_id`, `url`, `final_url`, `kind` (webpage | pdf), `status_code`, `content_hash`, `title`, `text`, `html`, `fetch_tier`, `is_shell`, `robots_disallowed` (`packages/research/src/schema.ts:35`–`47`)

Citations: `packages/research/src/schema.ts:31`

## Connected to

- **owned-by:** [[leads/company]]
- **owns:** [[research/enrichment]] (`document_id`)
- **joins:** [[sms/sms-contact]] (`source_document_id`), the address provenance on [[email/message]]

## If you change this

- **Hits:** crawler and renderer (`packages/research/src/enrichment/crawler.ts:133`, `render.ts:156`); email scan (`packages/research/src/enrichment/email-scan.ts`); extraction (`packages/research/src/enrichment/extraction.ts`); phone lift (`packages/channel-sms/src/lift.ts:77`)
- **Does not hit:** discovery (it decides the domain before any page is stored)

## Surfaces

| Surface | Role |
|---|---|
| `Enrichment.crawl`, `Enrichment.render` | write |
| `Enrichment.scan/extract`, `SmsDesk.lift` | read |

## See

- Source: `packages/research/src/enrichment/crawler.ts`
