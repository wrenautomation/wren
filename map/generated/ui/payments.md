# Payments: app, client workspace

Send a pay link by text or email. See who paid.

Sidebar: client: Business.

Registered in `apps/portal/web/src/modules/payments/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Pay links | list of `payments.link` | `apps/portal/web/src/records.tsx` | `public.clients`, `public.pay_links` | Links your customers pay you through, and whether they paid. |
