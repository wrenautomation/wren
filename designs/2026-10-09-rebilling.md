# Rebilling usage on invoices, 2026-10-09

Gaps item 9. GHL rebills SMS, AI and voice at a markup. We meter a client's managed usage into
`books.usage_lines` (drafts, setup-and-vendors.md "Billing"), but nothing put them on a bill.

## What

- The month's bill (D15, `billsDue`) carries the client's unbilled usage: every draft usage line
  before the bill's month, in the bill's currency, amount over 0. Usage is billed in arrears: the
  November bill carries October's texts. A line missed once rides the next bill.
- A client with two engagements: the usage rides the bill of the lowest engagement id that has
  one this month. A client with usage and no other fee still gets a bill.
- A bill is lines: "Monthly fee", "4 × meeting booked at $500.00", "Texts, October: 1,240 message
  parts". `billLines(bill)` says them; the 1st's ping lists them, so the person typing the Wise
  invoice copies them line for line.
- `delivery.invoices.lines` (jsonb) keeps what an invoice billed, line by line, with each usage
  line's vendor and month. `addInvoice --period` fills it from the bill when the amount matches the
  bill; then it marks those usage lines `on_invoice`, so the daily rewrite keeps them. An amount
  that doesn't match is one line, its description, and the usage stays a draft for next time.
- Voiding an invoice puts its usage lines back to draft.
- The client sees the lines on the invoice in Account → Billing.

## Not now

- Sending: Wise has no invoice API we can use, so typing the invoice in Wise stays a person's step,
  as it is today. A Stripe invoice on Wren's own account would send it; that is money, William's.
- Markup stays William's vendor setting, default 0.

## Decision log

- 2026-10-09: The link is on the invoice (`lines`), not a column on `usage_lines`: books never
  imports delivery, delivery reads books' schema.
