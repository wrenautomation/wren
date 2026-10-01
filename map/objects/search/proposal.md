---
type: object
cluster: search
universe: live
status: verified
verified: 2026-09-30 @ 99fd3f6
entity: packages/channel-search/src/schema.ts:163
---

# proposal

One edit the model proposes to the site so it answers a keyword better. Table `search_proposals`.

## Why this shape

The copy is William's and a lander push is a deploy, so a proposal never applies itself. It quotes the current text word for word (`current`), and code refuses one whose quote isn't on the live site, or that names a price, uses a dash, or states a number the site doesn't (`propose.ts:59`). `wren search pr` applies only quotes found exactly once in `lander/src/content/` (`apply.ts:24`).

## Shape

- `made_on`, `page`, `kind` title / description / heading / copy / faq / page, `current`, `proposed`, `why`, `keywords`, `state` open / taken / dropped, `pr`, `llm` (the call record) (`schema.ts:163`)

Citations: `packages/channel-search/src/propose.ts:80`, `packages/channel-search/src/apply.ts:24`

## Connected to

- **joins:** [[search/keyword]] via `keywords` (phrases, not ids)

## If you change this

- **Hits:** `propose`, `applyProposals`, `wren search proposals/drop/pr`
- **Does not hit:** the lander until a person merges the PR

## Surfaces

| Surface | Role |
|---|---|
| `SearchWeek.run`, `wren search propose` | write (a new batch stales the open ones) |
| `wren search pr` | marks applied ones `taken` with the PR URL |

## See

- Process: [[search-loop]]
