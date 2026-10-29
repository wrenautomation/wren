# Marketing: app, client workspace

Your posts, drafts, ads and search in one place.

Sidebar: client: Marketing.

Registered in `apps/portal/web/src/modules/marketing/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Inbox (link only) | list of `marketing.inbox` | `apps/portal/web/src/records.tsx` | `public.call_invites`, `public.chat_messages`, `public.chat_threads`, `public.clients`, `public.companies`, `public.decisions`, `public.draft_activity`, `public.enrollments`, `public.inbox_threads`, `public.messages`, `public.people`, `public.sms_contacts`, `public.sms_messages`, `public.thread_events`, `public.wren_settings`, `watch.mail`, `watch.mail_records` | Messages, comments and replies waiting on you, from every channel. |
| Auto-reply | hand | `apps/portal/web/src/modules/marketing/auto-reply.tsx` | `ConsolePortal/call` | What happens when someone writes in, per channel. |
| Reviews | list of `marketing.review` | `apps/portal/web/src/records.tsx` | `public.comments`, `public.inbox_replies` | Reviews of your business, each with a reply to send. |
| To approve | list of `marketing.asked_reply` | `apps/portal/web/src/records.tsx` | `public.broadcast_records`, `public.inbox_replies`, `public.send_attempts` | Inbox replies and broadcasts that wait on a yes, and sends that may have gone out. |
| Drafts (link only) | list of `marketing.draft` | `apps/portal/web/src/records.tsx` | `public.draft_activity`, `public.marketing_draft_records` | Every post draft: edit it, approve it, it goes out. |
| Posts (link only) | list of `marketing.post` | `apps/portal/web/src/records.tsx` | `public.draft_activity`, `public.marketing_post_records` | Every post that went out, best first. |
| Ads | list of `marketing.ad_day` | `apps/portal/web/src/records.tsx` | `public.marketing_ad_day_records` | How each ad set did, day by day. |
| Search | list of `marketing.search_page` | `apps/portal/web/src/records.tsx` | `public.marketing_search_page_records` | Your site's pages, and whether Google has them. |
| Keywords | list of `marketing.keyword` | `apps/portal/web/src/records.tsx` | `public.marketing_keyword_records` | The searches you show up for, and where you rank. |
| Reports | hand | `apps/portal/web/src/modules/marketing/reports.tsx` | `MarketingConsole/reports` | Your numbers by email each week or month, against the one before. |
