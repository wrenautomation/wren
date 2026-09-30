---
type: object
cluster: books
universe: live
status: verified
verified: 2026-09-30 @ 0964efe
entity: packages/books/src/schema.ts:58
---

# vendor

Who bills us: one `books.vendors` row each, seeded from `VENDORS` in code, which also says which senders and subjects are its bills.

## Why this shape

Capture asks Gmail only for known billing senders, so the personal inbox is never scanned wholesale; a new vendor is one entry in `VENDORS`. The row carries what a bill may not print: the expense account, the usual cycle, and whether its GST can be claimed back (`gst_claimable`: false on the simplified regime, null when unknown).

## Shape

- `vendors` (`schema.ts:58`): key, name, `account_id`, cycle, `gst_claimable`
- Mail rules, code only (`packages/books/src/chart.ts:60`): `from` senders and `subject` words; `billingQuery` builds the one search (`packages/books/src/mailbox.ts:92`), `vendorFor` matches a message (`:107`)
- `seedBooks` upserts chart and vendors before every import (`chart.ts:124`)

Citations: `packages/books/src/schema.ts:58`, `packages/books/src/chart.ts:60`, `:124`

## Connected to

- **owns:** [[books/bill]], [[books/document]]
- **joins:** [[books/entry]] (its account is where its bills post)

## If you change this

- **Hits:** capture's search, the reading prompt (`readingPrompt`, `packages/books/src/read.ts:43`), `check`'s GST rule and last-resort cycle (`packages/books/src/ground.ts:250`)
- **Does not hit:** bills already saved (a changed account reaches new bills only)

## Surfaces

| Surface | Role |
|---|---|
| `VENDORS` in code | writes |
| `wren books import` | seeds, reads |

## See

- Source: `packages/books/src/chart.ts`
