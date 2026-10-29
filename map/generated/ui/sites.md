# Sites: app, wren workspace

Every lander, listicle, funnel page and hosted form, with its visits, submits and bookings.

Sidebar: team: Tools.

Registered in `apps/portal/web/src/modules/sites/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Pages | list of `sites.page` | `apps/portal/web/src/records.tsx` | `public.site_page_records` | The pages Wren built for you, and how each one does. |
| Funnel | list of `sites.funnel` | `apps/portal/web/src/records.tsx` | `public.site_funnel_records` | Each page's visits, forms and bookings. |
| Funnel map | hand | `apps/portal/web/src/modules/sites/funnel-graph.tsx` | `ConsolePortal/recordsList` | Where visits came from, where they landed, and what they did next. |
| Links | list of `sites.link` | `apps/portal/web/src/records.tsx` | `public.site_link_records` | Tracked links to your pages, one for each place you post them. |
| Forms | list of `sites.form` | `apps/portal/web/src/records.tsx` | `public.site_form_records` | The forms on your pages. |
| Submissions | list of `sites.entry` | `apps/portal/web/src/records.tsx` | `public.site_entry_records` | Every form someone sent from your pages, in full. |
