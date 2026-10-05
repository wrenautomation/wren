# Marketing app

Living doc. Started 2026-10-05. William's 10-03 notes asked for "full UI for stats on marketing and sales". Sales has its apps: Pipeline, Outbound, Inbox, and Money's CAC, LTV and churn. Marketing has none. Content, ads, search, texts and site visits are in Postgres or one fetch away, but you can only see them through the CLI and Discord.

## Answer first

There's one new app, Marketing, built from records and templates only (the console standard). It has six pages: Overview, Content, Ads, Search, Texts and Site. The opt-in marketing records from `2026-10-04-borrowed-ui.md` (Subscribers, Topics) live in this app too. Two small tables keep numbers that are fetched today and thrown away: ad days and site days. No new loop: each is one more step in a daily pass that already runs, because Restate entries are the meter.

## Sources

| Page | Rows | From |
|---|---|---|
| Content | a published post | `content_drafts` (published) joined to its newest `content_metrics` row |
| Ads | an ad set and a day | new `ad_days`, written by `AdsWatch/default` from the 7-day insights it already reads |
| Search | a page or a keyword | `search_pages`, `search_keywords`, `search_days` (Search Console), `search_answers` (GEO) |
| Texts | a contact | `sms_contacts`, `sms_messages`, `sms_events` |
| Site | a source and a day | new `site_days`: the lander export (`/api/export`) rolled up per day, channel and campaign, written by the daily pass that already reads it (`SearchWatch` or the clicks read, whichever runs daily) |

`site_days` holds counts only (visits, first touches, forms, bookings, watch plays). It never holds a visitor id, so the 09-29 "read only, nothing stored" rule about people still holds. Day rows are upserted, so a re-read never double counts.

## Records

The fields use kinds that already exist: `money` sums, `rate` pools with Wilson, `date`, `status`.

- `marketing.post`: platform, title or first line, published, views, reactions, comments, shares, engagement `rate` (reactions + comments + shares over views), and link. Views are All, by platform, This week and Top. Record actions: open the post, redraft (calls `Content` as the CLI does).
- `marketing.ad_day`: campaign, ad set, day, spend in `money`, impressions, clicks, CTR `rate`, leads, and cost per lead. Views are Last 7 days, Last 30, and by campaign. Record actions: pause and resume (the `Ads` handlers, effect `spend`).
- `marketing.search_page` and `marketing.keyword`: clicks, impressions, CTR `rate`, average position, and the change from last week. `marketing.answer`: an AI-engine answer that did or didn't name Wren.
- `marketing.text_contact`: state, base (published or opt-in), last message, disposition, and replies `rate`. Views are Replied, Opted out and Waiting. Its actions are the SMS desk's existing approve and drop.
- `marketing.site_day`: channel, campaign, visits, forms, bookings, and visit-to-booking `rate`.

## Overview

The tiles are the Overview template's, with this month against last:

- reach (content views plus ad impressions plus search impressions);
- site visits;
- forms and bookings, by first touch;
- ad spend in `money` and cost per booking;
- net subscribers, once opt-in marketing runs.

Under the tiles is one chart: bookings by first-touch channel per week (Recharts, as on Money). The tiles link to their pages with the period filter set.

## Access

Marketing is a Wren app (scope `wren`, `2026-10-05-access.md`). Pause and resume need `effect`. Everything else needs `read`. A client sees its own Marketing app when it installs a component that provides it. That component's manifest is `marketing.stats`, not ready until a client runs content.

## Phases

- K1. `ad_days` and `site_days`, with their migration and the extra daily steps. Integration tests: an upsert is idempotent, and a re-read doesn't double count.
- K2. Views and records for Content, Ads, Search, Texts and Site, with column totals where take 1 of borrowed UI has landed.
- K3. The app module, Overview and chart, plus prod screenshots at 1360 and 390.

## Done when

- Each page lists real prod rows, with totals that match the CLI's numbers for the same period (`wren content stats`, `wren ads`, `wren search`).
- No new Restate loop, and no extra Restate entries beyond one step in each existing daily pass.
- Gates pass, the map cards are updated, and the component inventory test holds.

## Decision log

- 2026-10-05: Written. Day tables only where the source forgets: Meta's insights and the lander's export. Everything else is already stored. Counts per day, never visitor ids. One app for all of marketing, not one per channel: William reads marketing as one funnel.
- 2026-10-05: K1 built (f681fa0). `touchChannel` moved to core so site days and email clicks share it. Site `bookings` are booking-link clicks: `call_bookings` only attributes email.
- 2026-10-05: K2 built. Records live in each channel package, wired by `apps/worker/src/marketing.ts`; no new package. Search has three pages (pages, keywords, AI answers) plus a hidden search-days list behind the reach tile, so the app has eight pages, not six. Post action is "draft again" (`ContentDesk.draft` with `again`): `redraft` refuses a published post. SMS has no approve or drop handlers, so a texted contact's action is mark read. Ads gets `resume`: it restarts a stopped launch at its recorded budget.
- 2026-10-05: K3 built. Reach is three tiles (content views, ad impressions, search impressions): a tile reads one record, so there is no cross-record sum. No cost-per-booking tile: there is no ratio tile; the Site page's rate and the Ads page's cost per lead carry it. Plain `number` columns get no footer total; rate columns pool their sums. Recharts is gone, so the weekly chart is drawn by hand from `recordsStats` (8 weeks, top four channels plus the rest). Resume needs `effect` (it spends; the console checks the role and asks for the handler's name). Pause needs `run`, not `effect`: stopping never spends, and labeling it an effect would make an operator type a confirm to cut spend. Net subscribers and the Subscribers and Topics pages land with opt-in marketing.
