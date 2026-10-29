# Sites: app, client workspace

Your landing pages, their copy, tracked links, visits, forms, bookings and ads.

Sidebar: client: Marketing.

Registered in `apps/portal/web/src/modules/sites/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Pages | list of `sites.page` | `apps/portal/web/src/records.tsx` | `public.site_page_records` | Every landing page, and how each one does. |
| Links | list of `sites.link` | `apps/portal/web/src/records.tsx` | `public.site_link_records` | Tracked links to your pages, one for each place you post them. |
| Forms | list of `sites.form` | `apps/portal/web/src/records.tsx` | `public.site_form_records` | The forms on your pages. |
| Submissions | list of `sites.entry` | `apps/portal/web/src/records.tsx` | `public.site_entry_records` | Every form someone sent from your pages, in full. |
