# Wise billing

2026-10-15. William: "can we integarte wise into our payment isntead of stripe? i have a wise account and all i wodl prefer direct wire transfers thorugh that at least for now."

Bead wa-61i.

## What it is

Wren bills its own clients by bank transfer into our Wise account. Wren makes the invoice, mails it, reads the money in and marks it paid. Nobody types an invoice in Wise.

Stripe stays only where a client's customers pay the client by card with the client's own key (`packages/payments`: text-to-pay, pay links). That is not Wren's billing and is untouched.

## Flow

1. **An invoice is made.** `addInvoice` (CLI `delivery invoice <amount>`), `setupInvoice` (CLI `delivery onboard` with a setup fee) or `billMonth` (BillingWatch from the 1st, one per `billsDue` row). The number comes from the sequence `delivery.invoice_number`: `WREN-1001`, `WREN-1002`, ... It is also the memo reference. No separate reference column.
2. **It is mailed.** BillingWatch's pass mails every open, unmailed, non-demo invoice of a client with the `delivery.invoices` product to the client's owners (the same billing contacts reminders use). The mail carries the PDF (`@wren/documents` `invoicePdf`, pdf-lib) and the bank details as text. `mailed_at` is set once every owner's send went; a failed send is tried next pass.
3. **The client wires it.** The PDF, the mail and the portal's Billing page show "Pay by bank transfer": the reference, the amount and the receive details for the invoice's currency. On the portal each value has a copy button. A currency we hold no account in says to reply for details.
4. **The money is read.** Every 15 minutes BillingWatch reads each Wise balance's statement for the last 7 days and stores each credit once, by Wise's reference number (`delivery.wise_credits.wise_id`, unique). Reading a window twice adds nothing.
5. **It is matched.** See Matching. Matched: `received_cents` goes up; covered, the invoice is paid on the credit's day through `markInvoice`, which runs the setup gate. A notice says what was paid. The rest wait.
6. **The rest wait on William.** A credit marked `review` shows in To approve (type `credit`, "Payment to match") with its candidate invoice, and in Money → Payments in. Actions: put it on the candidate or a named invoice, or set it aside. Never auto-marked.

## Matching

`matchCredit` in `packages/delivery/src/billing/match.ts`. In order:

1. Our own moves (conversion, top-up, interest, card refund and the like) are `ignored`: stored, never matched, hidden from lists by default.
2. **Reference.** Any `WREN-n` in the memo or description (`wren 1001`, `WREN1001` too). Paid only if the currency matches, the invoice is open and the credit is exactly what's due. Exact means the amount that landed or the amount sent (landed + Wise's fee) equals what's due; a fee we eat is not a short payment. Otherwise it waits: partial, over, wrong currency, closed invoice, or two invoices named.
3. **Amount and payer.** No reference: exactly what's due, same currency, payer named like the client (lower case, no punctuation, no Inc/LLC/Ltd; one name holds the other), and only one such invoice. Otherwise it waits with the likeliest invoice beside it.

By hand (`matchByHand`): counts the whole amount sent toward the invoice. Refused when the credit is already matched (409), the currencies differ (400) or the invoice isn't open (409). A partial by hand stays open until the rest arrives.

## Wise access

- `WISE_API_TOKEN`: a personal token, **read only**. `wiseReader` only sends GET: `/v4/profiles/{id}/balances` then `/v1/profiles/{id}/balance-statements/{balance}/statement.json` (COMPACT) per balance. No Wise SDK for Node exists; three GETs need none. Errors name the path and status, never the token.
- `WISE_PROFILE_ID`: the business profile.
- `WISE_RECEIVE_DETAILS`: JSON per currency (`name`, `bank`, `address`, `routing`, `institution`, `transit`, `sortCode`, `account`, `iban`, `swift`). The read-only token gets 403 on `account-details`, so these are stored. They came from the statement's `bankDetails`. USD, CAD, EUR and GBP are set.
- All three live in `/wren/prod/env-2` (JSON). Never in the repo. Read at runtime by `@wren/config`. A malformed value prints no bank numbers at all.
- **Webhook:** `POST /v3/profiles/{id}/subscriptions` for `balances#credit` returned 403 with this token. So there is no receiver: BillingWatch polls. A token that can make subscriptions could also move money, so we keep polling.

## Data

- `delivery.invoice_number`: sequence from 1001. `delivery.invoices.number` defaults to `'WREN-' || nextval(...)`.
- `delivery.invoices`: `received_cents` (sum of credits applied), `mailed_at`. `link` (Wise's pay page) is gone.
- `delivery.wise_credits`: one row per Wise credit. Status `matched` | `review` | `ignored` | `dismissed`; `invoice_id` (matched: paid toward; review: the candidate); `why`; `decided_by`/`decided_at`; `raw` (Wise's line, for audit). Audited under the money area.
- Refunds and disputes stay manual records. A bank transfer has no chargeback: a dispute is a client contesting a paid invoice, settled by hand. Lost on a setup fee still pauses the plan.

## Surfaces

- **Portal, client:** Account → Billing lists invoices; an open one's detail shows How to pay with copy buttons and a PDF download (`delivery/invoicePdf`, money permission).
- **Portal, team:** Money → Payments in (`console.credit`): To look at, Paid, All, Our own moves. Put on invoice, Set aside. To approve shows the waiting ones under Payments.
- **CLI:** `wren --client X delivery invoice <amount> --for ... --due ...`, `delivery onboard` (makes the setup invoice), `delivery wise [--status s] [--all]`, `delivery match <credit> <invoice>`, `delivery dismiss <credit>`, `delivery billing status|start|stop|sync`.
- **Loop:** `BillingWatch/fleet`. Off until started. DeliveryWatch still flags a month's bill not made (BillingWatch off), a setup fee unpaid, overdue invoices and open disputes, and still sends the due-soon reminder.

## Before starting BillingWatch

Its first pass bills the current month for every signed, running agreement (`billMonth`) and mails every open invoice not yet mailed. Check prod for signed non-demo agreements and open invoices first. On 2026-10-15 prod had no invoices.

## Decisions

- The invoice number is the memo reference. One string for the client to type.
- One loop does billing, mail and credits: they share the 15-minute pace and one status.
- Billing contacts are the client's owners, as for reminders.
- Mail goes from portal@ through the portal mailbox, with nodemailer's MailComposer for the attachment.
- Contract text ("We bill through Wise") is unchanged: it is still true and is versioned legal text.
