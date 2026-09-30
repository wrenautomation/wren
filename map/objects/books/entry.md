---
type: object
cluster: books
universe: live
status: verified
verified: 2026-09-30 @ 3daced1
entity: packages/books/src/schema.ts:390
---

# entry

A double-entry journal entry: `books.entries` with its `books.lines`, over the chart in `books.accounts`, at rates from `books.rates`.

## Why this shape

The journal is the books; bills only explain it. An entry's lines sum to zero in CAD, checked by a deferred trigger at commit. Another trigger refuses any edit or delete: a fix is a reversing entry on the same date plus a new one, so history never moves. Each line keeps the original amount, currency, rate and where the rate came from (`same`, `stated`, `boc`, `card`).

## Shape

- `entries` (`schema.ts:390`): posted on (the bill's issue day), memo, `bill_id`, `reverses_id` (unique: reversed once at most), `run_id`
- `lines` (`:427`): account, `cad_cents` (+ debit, − credit), amount, currency, rate, rate source
- `accounts` (`:34`): the chart, seeded from `CHART` (`packages/books/src/chart.ts:19`), each with its T2125 line; `CARD` is the paying side (`chart.ts:14`)
- `rates` (`:369`): CAD per unit by day, currency and source
- Triggers: balance (`packages/db/drizzle/0025_books.sql:211`, `:224`), never edited (`:227`)
- View `spend` (`schema.ts:524`): expense per month, account and vendor

Citations: `packages/books/src/schema.ts:390`, `:428`, `:34`, `:370`, `packages/db/drizzle/0025_books.sql:211`

## Connected to

- **owned-by:** [[books/bill]] (`bill_id`)
- **joins:** [[ledger/run]] (`run_id`), [[books/vendor]] (through the bill, in `spend`)
- **looks-like-but-is-not:** `bill_lines` (a bill's printed items); `clients.accounts` and autobrowse accounts

## If you change this

- **Hits:** `planLines`, `post` (`packages/books/src/post.ts:38`, `:105`), `bocRate` (`packages/books/src/rates.ts:38`), the triggers, `bill_costs` and `spend`
- **Does not hit:** capture and reading (they never touch the journal)

## Surfaces

| Surface | Role |
|---|---|
| `wren books import` / `read` / `post` / `accept` / `personal` | write (each ends with a post) |
| `wren books spend` / `bills` | read |

## See

- Source: `packages/books/src/post.ts`, `packages/books/src/rates.ts`
