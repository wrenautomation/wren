---
type: object
cluster: books
universe: live
status: verified
verified: 2026-10-11 @ 4a396a2
entity: packages/books/src/schema.ts:397
---

# card-line

One charge or credit on William's card, from a statement file or BMO's purchase alert mail: one `books.card_lines` row each, sorted to a vendor or personal, matched to the bill it paid.

## Why this shape

The card is the one place every cost shows up, mailed bill or not. A line is sorted by William's rule for its descriptor (`card_rules`), else by the vendor's card words (`VendorSpec.card`). A business charge then finds its bill: same vendor, within 5 days, same CAD (a foreign bill within 6%, and it takes the CAD the card took as `charged_cad_cents`). After 5 days with no bill, one is made from the line (`card:<id>`, CAD, no tax), so a vendor that only bills the card (Inbox Insiders) still counts. A statement line takes over the alert it repeats (same card and amount, within 4 days), keeping its sort and bill. Re-importing a file adds nothing: OFX lines key on the bank's id, CSV lines on the line and how many like it came before.

## Shape

- `card_lines` (`schema.ts:397`): card (last four), on, description, descriptor (cleaned), amount (charge positive), currency, source (statement | alert), fingerprint, document, vendor, personal, bill
- `card_rules` (`:450`): descriptor → vendor or personal
- View `card_records` (`:803`): state to_sort | waiting | billed | card_only | personal | credit

Citations: `packages/books/src/schema.ts:397`, `:450`, `:803`, `packages/books/src/card.ts:200`, `:229`, `:348`, `:409`, `:434`, `:491`, `:550`

## Connected to

- **owned-by:** [[books/document]] (the statement file or alert email)
- **joins:** [[books/vendor]], [[books/bill]] (`bill_id`)
- **looks-like-but-is-not:** `bill_payments` (what a vendor says was paid; this is what the card says it took)

## If you change this

- **Hits:** `importStatement` (`card.ts:229`), `readCardAlerts` (`:348`), `sortCard` (`:409`), `ruleCard` (`:434`), `matchCard` (`:491`, voids a made bill when the mail turns up), `makeBill` (`:550`), the daily pass (`packages/books/src/daily.ts:88`, raises one `card` alert while descriptors wait), Money → Card
- **Does not hit:** the journal directly; made bills post like any other

## Surfaces

| Surface | Role |
|---|---|
| `wren books card import <file>` | writes (OFX/QFX or CSV) |
| `wren books card sort [descriptor] [vendor\|personal]` | lists what's left, or sets a rule |
| daily `Books/all` | reads alert mail, sorts, matches |
| Money → Card | read |

## See

- Source: `packages/books/src/card.ts`
- Design: `designs/2026-09-30-books.md`
