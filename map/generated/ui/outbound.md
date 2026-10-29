# Outbound: app, wren workspace

Campaigns and the inboxes that send them, the companies they reach and the texts.

Sidebar: team: Marketing.

Registered in `apps/portal/web/src/modules/wren/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Overview | overview | `apps/portal/web/src/records.tsx` |  | Cold email campaigns, inboxes and replies, at a glance. |
| Campaigns | list of `email.campaign` | `apps/portal/web/src/records.tsx` | `public.campaign_controls`, `public.email_campaign_records` | Every cold email campaign, and how it's doing. |
| Inboxes | list of `email.inbox` | `apps/portal/web/src/records.tsx` | `public.campaign_controls`, `public.companies`, `public.contact_candidates`, `public.enrollments`, `public.leads`, `public.messages`, `public.people`, `public.runs`, `public.sender_pauses`, `public.thread_events` | The mailboxes we send cold email from, and their health. |
| Signals | list of `research.signal` | `apps/portal/web/src/records.tsx` | `public.research_signals` | News about prospects that gives us a reason to write. |
| Lead sheet | overview | `apps/portal/web/src/records.tsx` |  | Companies our lead sources found, and how far each got. |
| Companies | list of `email.firm` | `apps/portal/web/src/records.tsx` | `public.email_firm_records` | Every company our lead sources found, with its people. |
| Stalls | list of `email.stall` | `apps/portal/web/src/records.tsx` | `public.enrollments`, `public.messages`, `public.pipeline_leaks` | Leads stuck before a send, and why. |
| Texts | list of `marketing.text_contact` | `apps/portal/web/src/records.tsx` | `public.marketing_text_contact_records` | Text conversations waiting on your reply. |
| Text copy | list of `marketing.text_copy` | `apps/portal/web/src/records.tsx` | `public.template_versions`, `public.templates` | The words of every text we send. |
