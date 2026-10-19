---
type: process
status: verified
verified: 2026-10-19 @ a6004537
consumes: ["[[clients/engagement]]", "[[clients/client-member]]", "[[clients/invoice]]"]
produces: ["[[clients/invoice]]", "[[ledger/run]]"]
---

# billing-watch

Every 15 minutes Wren's own billing moves: the month's invoices are made from the 1st, new invoices are mailed with their PDF, and money in is read from our Wise account and matched.

## Input → Movement → Output

Signed, running agreements (`billsDue`), open unmailed invoices of non-demo clients with `delivery.invoices`, and our Wise balance statements. `BillingWatch/fleet` (`packages/delivery/src/billing/watch.ts:118`) runs `billingPass` (`:71`) in a `runs` row. Out: invoices, `mailed_at`, `wise_credits` rows, paid invoices, notices. Off until `wren delivery billing start`; registered only when `WREN_PORTAL_ORIGIN` is set; mails only with `WREN_PORTAL_FROM` and `WREN_PORTAL_MAILBOX`; reads Wise only with `WISE_API_TOKEN` and `WISE_PROFILE_ID` (`apps/worker/src/services.ts`).

## Why this shape

Polling, not Wise's `balances#credit` webhook: the read-only token gets 403 creating a subscription, and a token that could would also move money. Each pass reads 7 days back; credits are unique by Wise id, so overlap is free and a missed pass costs nothing. One loop for bills, mail and credits keeps one pace and one status.

## Steps

1. `billMonth` (`packages/delivery/src/index.ts:994`): one invoice per `billsDue` row for the month, due in the client's pay days.
2. `mailInvoices` (`billing/mail.ts:72`): each open, unmailed invoice to every owner, PDF attached, bank details in the text; `mailed_at` once all sends went. A notice lists what went.
3. `wiseReader.credits` (`billing/wise.ts:76`): GET balances, then each balance's statement (COMPACT). GET only.
4. `takeCredits` (`billing/credits.ts:88`): each new credit decided by `matchCredit` (`billing/match.ts:69`) in its own serializable transaction. Matched: `received_cents` up, paid on the credit's day through `markInvoice` once covered (which runs the setup gate, `startIfReady`). The rest are `review` with the likely invoice, or `ignored` (our own moves).
5. Notices: "Paid by transfer" and "Payments to look at" to the main notifier. Waiting ones show in To approve.
6. Spine (J4): `claimInvoiceChanges` (`billing/tell.ts`) claims each new invoice change (invoiced, paid, refunded, late) once in `invoices.told`; the watch fires `trigger.payment` for each ([[clients/invoice]]).

## Surfaces

| Surface | Role |
|---|---|
| `wren delivery billing start/stop/status/sync` | the loop |
| `wren delivery wise`, `match`, `dismiss` | credits by hand |
| portal Money → Payments in, To approve | credits by hand (`BillingConsole`, `billing/console.ts:77`) |

## See

- Objects: [[clients/invoice]], [[clients/engagement]]
- Design: `designs/2026-10-15-wise-billing.md`
- Tests: `packages/delivery/test/integration/billing.test.ts`
