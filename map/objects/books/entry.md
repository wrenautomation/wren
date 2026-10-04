---
type: object
cluster: books
universe: live
status: verified
verified: 2026-10-04 @ d6098e4
entity: packages/books/src/schema.ts:391
---

# entry

A double-entry journal entry: `books.entries` with its `books.lines`, over the chart in `books.accounts`, at rates from `books.rates`.

## Why this shape

The journal is the books; bills only explain it. An entry's lines sum to zero in CAD, checked by a deferred trigger at commit. Another trigger refuses any edit or delete: a fix is a reversing entry on the same date plus a new one, so history never moves. Each line keeps the original amount, currency, rate and where the rate came from (`same`, `stated`, `boc`, `card`).

## Shape

- `entries` (`schema.ts:391`): posted on (the bill's issue day), memo, `bill_id`, `reverses_id` (unique: reversed once at most), `run_id`
- `lines` (`:429`): account, `cad_cents` (+ debit, − credit), amount, currency, rate, rate source
- `accounts` (`:42`): the chart, seeded from `CHART` (`packages/books/src/chart.ts:19`), each with its T2125 line; `CARD` is the paying side (`chart.ts:18`). An expense's `bucket` (acquisition, delivery, overhead; null is overhead) and `channel` (null is shared) start from `CHART` on the first seed only, then are William's (`schema.ts:53`, `:55`)
- `rates` (`:371`): CAD per unit by day, currency and source
- Triggers: balance (`packages/db/drizzle/0025_books.sql:211`, `:224`), never edited (`:227`)
- View `spend` (`schema.ts:548`): expense per month, account and vendor
- Unit economics views (`packages/books/src/economics.ts`, design `designs/2026-10-04-unit-economics.md`): `econ_paid` (paid invoices in CAD at the BoC rate), `econ_client_months`, `econ_months` (every figure per month), `econ_channels` (spend and cost per funnel stage per channel), `econ_cohorts` (`:20`, `:56`, `:111`, `:222`, `:320`), served as records `books.month`, `.channel`, `.cohort`, with `books.account` for each account's bucket and channel (`packages/books/src/records.ts:89`). They read `delivery.*`, `public.clients` and the channel tables by name; `economics.test.ts` pins those columns

Citations: `packages/books/src/schema.ts:391`, `:429`, `:42`, `:371`, `packages/books/src/economics.ts:20`, `packages/db/drizzle/0025_books.sql:211`

## Connected to

- **owned-by:** [[books/bill]] (`bill_id`)
- **joins:** [[ledger/run]] (`run_id`), [[books/vendor]] (through the bill, in `spend`), [[clients/engagement]] (invoices and client lives, in the `econ_*` views)
- **looks-like-but-is-not:** `bill_lines` (a bill's printed items); `clients.accounts` and autobrowse accounts

## If you change this

- **Hits:** `planLines`, `post` (`packages/books/src/post.ts:38`, `:105`), `bocRate` (`packages/books/src/rates.ts:38`), the triggers, `bill_costs` and `spend`; `books.spend_records` and `books.subscription_records` (console records, migration 0061); the `econ_*` views (a bucket or channel change moves CAC and margin)
- **Does not hit:** capture and reading (they never touch the journal)

## Surfaces

| Surface | Role |
|---|---|
| `wren books import` / `read` / `post` / `accept` / `personal` | write (each ends with a post) |
| `wren books spend` / `bills` | read |

## See

- Source: `packages/books/src/post.ts`, `packages/books/src/rates.ts`
