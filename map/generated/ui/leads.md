# Pipeline: app, client workspace

Companies from found to verified lead, and where they stall.

Sidebar: client: Leads.

Registered in `apps/portal/web/src/modules/wren/index.ts`.

| Page | Template | Drawn in | For |
|---|---|---|---|
| Overview | overview | `apps/portal/web/src/records.tsx` | Companies our lead sources found, and how far each got. |
| Companies | list of `email.firm` | `apps/portal/web/src/records.tsx` | Every company our lead sources found, with its people. |
| Stalls | list of `email.stall` | `apps/portal/web/src/records.tsx` | Leads stuck before a send, and why. |
