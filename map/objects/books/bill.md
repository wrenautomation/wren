---
type: object
cluster: books
universe: live
status: verified
verified: 2026-09-30 @ b96c9f8
entity: packages/books/src/schema.ts:171
---

# bill

A vendor's invoice or receipt as printed: one `books.bills` row per vendor and number, with its lines, taxes, payments and documents.

## Why this shape

Every figure must be printed on a document we keep, so a bill is the vendor's record, not our summary. The invoice email, its PDF and a later payment notice all link to one bill; a copy with a different total holds it instead of making a second. `review` decides posting: `ok` and `accepted` post, `needs_review` waits with its `review_reasons`, `personal` is kept and never posted. `void` is kept and never posted too: its document, read again, no longer gives it (an order confirmation, a number read wrong); a document that names it again revives it.

## Shape

- `bills` (`schema.ts:171`): number, kind (invoice | receipt | credit_note), issued, due, period, currency, subtotal, tax, total, `charged_cad_cents`, plan, cycle, payment method, billed-to, vendor tax number, account, review and reasons, the document read
- `bill_lines` (`:240`), `bill_taxes` (`:268`, `claimable` per tax), `bill_payments` (`:301`, one row per reference or day and amount, linked by invoice number; none printed = on account, left for statements to place), `bill_documents` (`:345`)
- Views: `bill_costs` (`:468`, CAD from the live entry), `subscriptions` (`:501`, renews a cycle after the last bill; leaves out personal and void)

Citations: `packages/books/src/schema.ts:171`, `:240`, `:268`, `:301`, `:345`, `:468`, `:501`, `packages/books/src/read.ts:387`

## Connected to

- **owned-by:** [[books/vendor]]
- **owns:** its lines, taxes, payments
- **joins:** [[books/document]] (`document_id`, `bill_documents`), [[books/entry]] (`entries.bill_id`), [[ledger/run]]
- **looks-like-but-is-not:** reactivation's `billOf` (what a client owes us, `packages/reactivation/src/handoff.ts:157`); `bill_lines` vs the journal's `lines`

## If you change this

- **Hits:** `check` (`packages/books/src/ground.ts:241`), `saveBill` (`packages/books/src/read.ts:298`), `voidStale` (`:387`), `listPayments` (`packages/books/src/report.ts:114`), `planLines` (`packages/books/src/post.ts:38`), the three views, `wren books bills | show | payments | spend | subs`
- **Does not hit:** capture (it stores documents, never bills)

## Surfaces

| Surface | Role |
|---|---|
| `wren books import` / `read` | writes |
| `wren books accept` / `personal` | set `review` |
| `wren books bills` / `show` / `payments` / `subs` / `spend` | read |

## See

- Source: `packages/books/src/read.ts`, `packages/books/src/ground.ts`
- Design: `designs/2026-09-30-books.md`
