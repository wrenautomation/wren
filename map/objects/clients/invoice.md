---
type: object
cluster: clients
universe: live
status: verified
verified: 2026-10-19 @ a6004537
entity: packages/delivery/src/schema.ts:372
---

# invoice

What Wren bills a client, per engagement, paid by bank transfer into our Wise account (`delivery.invoices`). Beside it, `delivery.wise_credits`: each payment Wise shows us, and the invoice it paid or waits beside.

## Why this shape

Wren makes the invoice and the client types its number into the transfer memo, so the number is ours (sequence `delivery.invoice_number`, `WREN-1001` on) and is the match key; no separate reference. Money in is a row per Wise transaction, unique by Wise's reference number, so reading the same statement window twice adds nothing. `received_cents` sums what was applied, so a partial stays open until the rest lands. Only exact matches apply themselves; everything else waits on a person (design: "never auto-mark").

## Shape

- `invoices` (`schema.ts:372`): `number` defaults to `'WREN-' || nextval('delivery.invoice_number')` (`:364`); cents, currency, dates, status (`open`, `paid`, `void`), `received_cents`, `mailed_at`, `setup`, `period`, `units`, `lines` (jsonb), `refunded_cents` and `dispute` (manual records: a bank transfer has no chargeback).
- `wise_credits` (`schema.ts:443`): `wise_id` (unique), balance, currency, `cents` (landed) and `fee_cents`, payer, memo, `status` (`matched`, `review`, `ignored`, `dismissed`), `invoice_id` (matched: paid toward; review: the likely one), `why`, who decided, `raw`. Audited under money (`packages/db/src/audit/install.ts`).
- Writes: `addInvoice`, `billMonth`, `setupInvoice`, `markInvoice` (`packages/delivery/src/index.ts:723`, `:994`, `:1020`, `:1040`); `takeCredits`, `matchByHand`, `dismissCredit` (`billing/credits.ts:88`, `:152`, `:193`).
- Matching: `matchCredit` (`billing/match.ts:69`): reference in the memo, else exact amount + currency + payer named like the client; own moves (`OWN_KINDS`, `billing/wise.ts`) ignored.
- Bank details: `WISE_RECEIVE_DETAILS` in `/wren/prod/env-2`, parsed by `parseReceive` and printed by `payFields` (`billing/receive.ts:27`, `:51`). Never in the repo.
- PDF: `invoicePdf` (`packages/documents/src/pdf.ts:192`) via `invoiceFile` (`billing/mail.ts:20`); the portal's download is `delivery/invoicePdf` (`service.ts:527`, money permission).
- Read with `money` on the client: `invoicesOf` (`index.ts:1872`) reports open past due as `overdue`.

- `told` (migration `0299_invoice_told`): which of `invoiced`, `paid`, `refunded`, `late` the spine has heard, each with the claim token. `BillingWatch` fires `trigger.payment` once per change after its pass (`claimInvoiceChanges`, `packages/delivery/src/billing/tell.ts`), about the billing email (else the first owner). The demo client tells nothing. A manual `markInvoice` is heard at the next pass.

Citations: `packages/delivery/src/schema.ts:364`, `:372`, `:443`, `packages/delivery/src/billing/match.ts:69`, `packages/delivery/src/billing/credits.ts:88`

## Connected to

- **owned-by:** [[clients/engagement]] (cascade)
- **joins:** [[clients/client-member]] (owners get the mail), [[clients/client-flag]] (`invoice:<id>`, `dispute:<id>`, `bill:<month>`), [[platform/audit-log]]
- **looks-like-but-is-not:** `payments.pay_links` (a client's customers paying the client by card through the client's own Stripe; not Wren's billing)

## If you change this

- **Hits:** [[processes/billing-watch]], [[processes/delivery-watch]] (reminders, overdue and dispute flags, the setup gate), [[clients/client-health]] (money), the `books.econ_*` views (read `invoices` by name), the portal's Account → Billing and Money → Payments in, To approve (`credit:` items, `packages/content/src/social/records.ts`), [[processes/migrate]].
- **Does not hit:** `packages/payments` and Stripe; client databases.

## Surfaces

| Surface | Role |
|---|---|
| portal Account → Billing (`apps/portal/web/src/modules/account/billing.tsx`) | the client's invoices, how to pay with copy buttons, the PDF |
| portal Money → Payments in (`console.credit`, `billing/records.ts:28`) | every credit; put on invoice, set aside (`BillingConsole`) |
| To approve, Payments view | credits that wait |
| `wren --client <id> delivery invoice <amount>`, `paid`, `void`, `refund`, `dispute` | the team's writes |
| `wren delivery wise`, `match <credit> <invoice>`, `dismiss <credit>` | credits by hand |

## See

- Design: `designs/2026-10-15-wise-billing.md`, `designs/2026-10-09-rebilling.md`
- Tests: `packages/delivery/test/integration/billing.test.ts`, `packages/delivery/src/billing/*.test.ts`
