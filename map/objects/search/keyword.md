---
type: object
cluster: search
universe: live
status: verified
verified: 2026-09-30 @ 99fd3f6
entity: packages/channel-search/src/schema.ts:85
---

# keyword

A phrase the site should be found for, and what Google and the answer engines say about it. Tables `search_keywords`, `search_days`, `search_answers`, `search_pages`.

## Why this shape

AI engines split a question into narrower searches and cite whoever answers the pieces, so a seed grows fan-out children (`parent_id`). Only seeds and real queries fan out; children never have children, so the list stays bounded (`keywords.ts:121`, `answers.ts:100`). `search_days` joins keywords by the exact query text, so a phrase is stored lowercased and squashed (`phraseKey`).

## Shape

- `search_keywords`: `phrase` unique, `page`, `source` seed / fanout / query, `parent_id`, `retired_at` (`schema.ts:85`)
- `search_days`: day × query × page, clicks, impressions, position (`schema.ts:28`)
- `search_pages`: URL × day inspected, verdict, coverage (`schema.ts:55`)
- `search_answers`: engine × keyword × day, cited, rank, sources, "People also ask" (`schema.ts:121`)

Citations: `packages/channel-search/src/schema.ts:85`, `packages/channel-search/src/keywords.ts:69`

## Connected to

- **joins:** [[search/proposal]] (the brief it is read from); [[ledger/run]] (`run_id`)
- **looks-like-but-is-not:** content ideas (`content` cluster): those are posts, these are phrases the site answers

## If you change this

- **Hits:** `syncSearch`, `discoverKeywords`, `fanOut`, `dueKeywords`, `brief`
- **Does not hit:** the lander (only proposals reach it, through a PR)

## Surfaces

| Surface | Role |
|---|---|
| `SearchWatch/default` | writes days and pages daily |
| `SearchWeek.run` | writes keywords and answers weekly |
| `wren search keywords/sync/discover/fanout/answers/brief` | read and write by hand |

## See

- Process: [[search-loop]]
- Source: `packages/channel-search/src/`
