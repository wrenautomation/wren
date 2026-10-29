# Texts: app, client workspace

Texts to leads and their replies, sorted.

Sidebar: client: Inbox.

Registered in `apps/portal/web/src/modules/texts/index.tsx`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Overview | overview | `apps/portal/web/src/records.tsx` |  | Your text replies, missed calls and reviews, at a glance. |
| Threads | list of `sms.thread` | `apps/portal/web/src/records.tsx` | `public.companies`, `public.documents`, `public.imports`, `public.people`, `public.runs`, `public.sms_contacts`, `public.sms_messages`, `public.sms_numbers` | Text conversations waiting on a reply. |
| Speed to lead | list of `sms.speed` | `apps/portal/web/src/records.tsx` | `public.companies`, `public.documents`, `public.people`, `public.sms_contacts`, `public.sms_numbers`, `public.speed_runs` | Each new lead and how fast they got a text and a call. |
| Missed calls | list of `sms.call` | `apps/portal/web/src/records.tsx` | `public.companies`, `public.documents`, `public.people`, `public.sms_calls`, `public.sms_contacts`, `public.sms_numbers`, `public.speed_runs` | Calls nobody picked up, and the text each caller got back. |
| Reviews | list of `sms.review` | `apps/portal/web/src/records.tsx` | `public.review_asks`, `public.sms_contacts` | Customers we asked for a review, and who left one. |
