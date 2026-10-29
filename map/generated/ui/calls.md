# Calls: app, client workspace

Booked calls, a brief before each, and how each went.

Sidebar: client: Leads.

Registered in `apps/portal/web/src/modules/calls/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Overview | overview | `apps/portal/web/src/records.tsx` |  | Your booked sales calls at a glance. |
| Calls | list of `email.call` | `apps/portal/web/src/records.tsx` | `public.call_bookings`, `public.companies`, `public.enrollments`, `public.people` | Sales calls booked with you, past and coming up. |
