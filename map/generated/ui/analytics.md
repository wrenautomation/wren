# Analytics: app, wren workspace

Visits, recordings, search and the funnel from first visit to booking.

Sidebar: team: Marketing.

Registered in `apps/portal/web/src/modules/analytics/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Visits | list of `marketing.site_day` | `apps/portal/web/src/records.tsx` | `public.marketing_site_day_records` | Visits to your site, day by day. |
| Sessions | list of `marketing.session` | `apps/portal/web/src/records.tsx` |  | Recordings of single visits to your site, to replay. |
| Heatmaps | list of `marketing.heat` | `apps/portal/web/src/records.tsx` | `public.marketing_heat_records` | Where visitors click and how far they scroll, per page. |
| Experiments | list of `marketing.experiment` | `apps/portal/web/src/records.tsx` | `public.flag_days`, `public.flag_experiments`, `public.flags` | Tests of a site's variants, and which one wins. |
| Surveys | list of `marketing.survey` | `apps/portal/web/src/records.tsx` | `public.clients`, `public.survey_answers`, `public.survey_days`, `public.surveys` | One-question surveys for site visitors or clients. |
| Survey answers | list of `marketing.survey_answer` | `apps/portal/web/src/records.tsx` |  | The answers your surveys got. |
| Search days (link only) | list of `marketing.search_day` | `apps/portal/web/src/records.tsx` | `public.marketing_search_day_records` | Your Google search numbers, day by day. |
| Search | list of `marketing.search_page` | `apps/portal/web/src/records.tsx` | `public.marketing_search_page_records` | Your site's pages, and whether Google has them. |
| Keywords | list of `marketing.keyword` | `apps/portal/web/src/records.tsx` | `public.marketing_keyword_records` | The searches you show up for, and where you rank. |
| AI answers | list of `marketing.answer` | `apps/portal/web/src/records.tsx` | `public.marketing_answer_records` | What AI assistants say when asked your keywords. |
| Funnel | list of `marketing.funnel` | `apps/portal/web/src/records.tsx` | `public.marketing_funnel_records` | Each channel's funnel, from first visit to booking. |
| Links (link only) | list of `marketing.link_day` | `apps/portal/web/src/records.tsx` | `public.marketing_link_day_records` | Who came through each tracked link, and what they did next. |
