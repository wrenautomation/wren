# @wren/calendar: routes

Services: 3.

## Calendar (service)

File: packages/calendar/src/restate.ts

- **book** `BookRequest` → `BookingView & { manage: string; }` (serviceHandler): writes calendar.bookings, pipeline.deals, pipeline.instances, public.call_bookings, public.enrollments, public.messages, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.suppression_events, public.suppressions; reads pipeline.shape_versions, public.companies, public.contact_candidates, public.leads, public.people, public.reach_contacts, public.runs, public.social_handles, public.touches
- **booking** `{ token: string }` → `BookingView` (serviceHandler): reads calendar.bookings
- **cancel** `{ token: string; reason?: string }` → `BookingView` (serviceHandler): writes calendar.bookings, pipeline.deals, pipeline.instances, public.call_bookings, public.enrollments, public.messages, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.suppression_events, public.suppressions; reads pipeline.shape_versions, public.companies, public.contact_candidates, public.leads, public.people, public.reach_contacts, public.runs, public.social_handles, public.touches
- **remind** `RemindRequest` → `{ sent: boolean; }` (serviceHandler): writes calendar.bookings
- **reschedule** `{ token: string; start: string }` → `BookingView` (serviceHandler): writes calendar.bookings, pipeline.deals, pipeline.instances, public.call_bookings, public.enrollments, public.messages, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.suppression_events, public.suppressions; reads pipeline.shape_versions, public.companies, public.contact_candidates, public.leads, public.people, public.reach_contacts, public.runs, public.social_handles, public.touches
- **slots** `void` → `SlotsView` (serviceHandler): reads calendar.bookings

## CalendarConsole (service via `portalService`)

File: packages/calendar/src/console.ts

- **cancel** `IdsRequest` → `{ cancelled: number; }` (serviceHandler): writes calendar.bookings, pipeline.deals, pipeline.instances, public.call_bookings, public.enrollments, public.messages, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.suppression_events, public.suppressions; reads pipeline.shape_versions, public.client_domains, public.client_members, public.clients, public.companies, public.contact_candidates, public.leads, public.people, public.reach_contacts, public.roles, public.runs, public.social_handles, public.touches
- **clear** `IdsRequest` → `{ changed: number; done: (number | undefined)[]; }` (serviceHandler): writes public.call_bookings; reads public.client_domains, public.client_members, public.clients, public.enrollments, public.messages, public.roles
- **noShow** `IdsRequest` → `{ changed: number; done: (number | undefined)[]; }` (serviceHandler): writes public.call_bookings; reads public.client_domains, public.client_members, public.clients, public.enrollments, public.messages, public.roles
- **notFit** `IdsRequest` → `{ changed: number; done: (number | undefined)[]; }` (serviceHandler): writes public.call_bookings; reads public.client_domains, public.client_members, public.clients, public.enrollments, public.messages, public.roles
- **notYet** `IdsRequest` → `{ changed: number; done: (number | undefined)[]; }` (serviceHandler): writes public.call_bookings; reads public.client_domains, public.client_members, public.clients, public.enrollments, public.messages, public.roles
- **range** `RangeRequest` → `CalendarRange` (serviceHandler): reads calendar.bookings, public.call_bookings, public.client_domains, public.client_members, public.clients, public.enrollments, public.messages, public.roles
- **record** `PortalRequest` → `import("./recorder.js").RecorderState` (serviceHandler)
- **recorder** `PortalRequest` → `import("./recorder.js").RecorderState` (serviceHandler)
- **recordsExport** `PortalRequest & ExportAsk` → `import("@wren/core/records/serve").RecordsFile` (serviceHandler): reads public.client_members, public.clients, public.custom_field_values, public.custom_fields, public.draft_events, public.draft_outcomes, public.draft_people, public.roles
- **recordsGet** `PortalRequest & GetAsk` → `import("@wren/core/records/serve").RecordAnswer` (serviceHandler): reads public.changes, public.client_members, public.clients, public.custom_field_values, public.custom_fields, public.roles, public.runs
- **recordsList** `PortalRequest & ListAsk` → `import("@wren/core/records/serve").RecordsPage` (serviceHandler): reads public.client_members, public.clients, public.custom_field_values, public.custom_fields, public.roles
- **recordsStats** `PortalRequest & StatsAsk` → `import("@wren/core/records/serve").RecordsStat` (serviceHandler): reads public.client_members, public.clients, public.custom_field_values, public.custom_fields, public.roles
- **recordsTypes** `PortalRequest` → `import("@wren/core/records").RecordMeta[]` (serviceHandler): reads public.client_members, public.clients, public.roles
- **stopRecording** `PortalRequest` → `import("./recorder.js").RecorderState` (serviceHandler)
- **won** `IdsRequest` → `{ changed: number; done: (number | undefined)[]; }` (serviceHandler): writes public.call_bookings; reads public.client_domains, public.client_members, public.clients, public.enrollments, public.messages, public.roles

## ClientCalendar (service)

File: packages/calendar/src/restate.ts

- **book** `z.infer<typeof CLIENT_BOOK>` → `BookingView & { manage: string; }` (serviceHandler): writes calendar.bookings, pipeline.deals, pipeline.instances, public.call_bookings, public.enrollments, public.messages, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.suppression_events, public.suppressions; reads pipeline.shape_versions, public.client_domains, public.clients, public.companies, public.contact_candidates, public.leads, public.people, public.reach_contacts, public.runs, public.social_handles, public.touches
- **booking** `{ client: string; token: string }` → `{ id: number; state: "booked" | "cancelled"; start: string; end: string; name: string; zone: string; title: string; offer: string | null; meetUrl: string | null; open: boolean; owner: string; mails: boolean; meet: boolean; contact: import("./contact.js").ContactLink[]; }` (serviceHandler): reads calendar.bookings, public.client_domains, public.clients
- **cancel** `{ client: string; token: string; reason?: string }` → `BookingView` (serviceHandler): writes calendar.bookings, pipeline.deals, pipeline.instances, public.call_bookings, public.enrollments, public.messages, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.suppression_events, public.suppressions; reads pipeline.shape_versions, public.client_domains, public.clients, public.companies, public.contact_candidates, public.leads, public.people, public.reach_contacts, public.runs, public.social_handles, public.touches
- **remind** `RemindRequest` → `{ sent: boolean; }` (serviceHandler): writes calendar.bookings; reads public.client_domains, public.clients
- **reschedule** `{ client: string; token: string; start: string }` → `BookingView` (serviceHandler): writes calendar.bookings, pipeline.deals, pipeline.instances, public.call_bookings, public.enrollments, public.messages, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.suppression_events, public.suppressions; reads pipeline.shape_versions, public.client_domains, public.clients, public.companies, public.contact_candidates, public.leads, public.people, public.reach_contacts, public.runs, public.social_handles, public.touches
- **slots** `{ client: string }` → `{ zone: string; length: number; title: string; slots: string[]; owner: string; mails: boolean; meet: boolean; contact: import("./contact.js").ContactLink[]; }` (serviceHandler): reads calendar.bookings, public.client_domains, public.clients
