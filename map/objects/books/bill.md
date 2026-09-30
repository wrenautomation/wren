---
type: object
cluster: books
universe: live
status: verified
verified: 2026-09-30 @ ec9a947
entity: packages/books/src/schema.ts:170
---

# bill

A vendor's invoice or receipt as printed: one `books.bills` row per vendor and number, with its lines, taxes, payments and documents.

## Why this shape

Every figure must be printed on a document we keep, so a bill is the vendor's record, not our summary. The invoice email, its PDF and a later payment notice all link to one bill; a copy with a different total holds it instead of making a second. `review` decides posting: `ok` and `accepted` post, `needs_review` waits with its `review_reasons`, `personal` is kept and never posted.

## Shape

- `bills` (`schema.ts:170`): number, kind (invoice | receipt | credit_note), issued, due, period, currency, subtotal, tax, total, `charged_cad_cents`, plan, cycle, payment method, billed-to, vendor tax number, account, review and reasons, the document read
- `bill_lines` (`:239`), `bill_taxes` (`:267`, `claimable` per tax), `bill_payments` (`:299`, one row per reference or day and amount, linked by invoice number), `bill_documents` (`:343`)
- Views: `bill_costs` (`:466`, CAD from the live entry), `subscriptions` (`:499`, renews a cycle after the last bill)

Citations: `packages/books/src/schema.ts:170`, `:239`, `:267`, `:299`, `:343`, `:466`, `:499`

## Connected to

- **owned-by:** [[books/vendor]]
- **owns:** its lines, taxes, payments
- **joins:** [[books/document]] (`document_id`, `bill_documents`), [[books/entry]] (`entries.bill_id`), [[ledger/run]]
- **looks-like-but-is-not:** reactivation's `billOf` (what a client owes us, `packages/reactivation/src/handoff.ts:157`); `bill_lines` vs the journal's `lines`

## If you change this

- **Hits:** `check` (`packages/books/src/ground.ts:240`), `saveBill` (`packages/books/src/read.ts:270`), `planLines` (`packages/books/src/post.ts:38`), the three views, `wren books bills | show | spend | subs`
- **Does not hit:** capture (it stores documents, never bills)

## Surfaces

| Surface | Role |
|---|---|
| `wren books import` / `read` | writes |
| `wren books accept` / `personal` | set `review` |
| `wren books bills` / `show` / `subs` / `spend` | read |

## See

- Source: `packages/books/src/read.ts`, `packages/books/src/ground.ts`
- Design: `designs/2026-09-30-books.md`
