# Numbers: app, wren workspace

How each node, edge and offer of the shape converts, and what a client costs and earns.

Sidebar: team: Primary.

Registered in `apps/portal/web/src/modules/numbers/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Shape | list of `pipeline.number` | `apps/portal/web/src/records.tsx` | `pipeline.deals`, `pipeline.instances`, `pipeline.shape_drafts`, `pipeline.shape_versions`, `pipeline.terms_versions`, `public.documents`, `public.events`, `public.profiles` | Each node and edge: who arrived, who went on, and how long it took. |
| Offers | list of `pipeline.number` | `apps/portal/web/src/records.tsx` | `pipeline.deals`, `pipeline.instances`, `pipeline.shape_drafts`, `pipeline.shape_versions`, `pipeline.terms_versions`, `public.documents`, `public.events`, `public.profiles` | Each offer's journeys, deals and what was collected. |
| Economics | overview | `apps/portal/web/src/records.tsx` |  | What it costs to win a client, and what a client brings in. |
| Months | list of `books.month` | `apps/portal/web/src/records.tsx` | `books.econ_months` | Every cost and revenue figure, month by month. |
| Channels | list of `books.channel` | `apps/portal/web/src/records.tsx` | `books.econ_channels` | Spend and the cost of a client for each channel, by month. |
| Cohorts | list of `books.cohort` | `apps/portal/web/src/records.tsx` | `books.econ_cohorts` | Clients grouped by the month they first paid. |
