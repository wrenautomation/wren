# Offers: app, wren workspace

Each offer Wren sells, its versions, and the terms it sells on.

Sidebar: team: Primary.

Registered in `apps/portal/web/src/modules/offers/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Offers | list of `pipeline.offer` | `apps/portal/web/src/records.tsx` | `pipeline.instances`, `pipeline.offer_versions`, `pipeline.shape_drafts`, `pipeline.shape_versions`, `pipeline.terms_versions`, `public.documents`, `public.profiles` | Every offer, its live plans and open journeys, with its versions and terms. |
| Terms | list of `pipeline.terms` | `apps/portal/web/src/records.tsx` | `pipeline.terms_versions` | The terms each plan sells on, with a button to propose the next version. |
