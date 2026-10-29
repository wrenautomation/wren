# Money: app, wren workspace

What Wren spends, what renews soon, and what a client costs and earns.

Sidebar: team: Tools.

Registered in `apps/portal/web/src/modules/wren/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Overview | hand | `apps/portal/web/src/modules/wren/money.tsx` |  | Where Wren's money goes, at a glance. |
| Spend | list of `books.spend` | `apps/portal/web/src/records.tsx` | `books.spend_records` | Everything we spend, by vendor and month. |
| Model usage | list of `email.model` | `apps/portal/web/src/records.tsx` | `public.email_model_records` | AI model calls, and what they cost. |
| Payments in | list of `console.credit` | `apps/portal/web/src/records.tsx` | `delivery.engagements`, `delivery.invoices`, `delivery.wise_credits`, `public.clients` | Bank transfers from clients, and the invoice each one paid. |
| Subscriptions | list of `books.subscription` | `apps/portal/web/src/records.tsx` | `books.subscription_records` | Every subscription we pay for. |
| Card | list of `books.card` | `apps/portal/web/src/records.tsx` | `books.card_records` | Charges on the company card, and the bill each one paid. |
| In-house | list of `books.in_house` | `apps/portal/web/src/records.tsx` |  | Tools we built instead of buying, and what they save. |
| Accounts | list of `books.account` | `apps/portal/web/src/records.tsx` | `books.accounts` | Expense accounts, and where each one's spend counts. |
