# @wren/channel-search: routes

Services: 1.

## SearchWeek (service)

File: packages/channel-search/src/restate/watch.ts

- **run** `{ today: string }` → `WeekStats` (serviceHandler): writes public.runs, public.search_answers, public.search_keywords; reads public.search_days
