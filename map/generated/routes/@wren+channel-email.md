# @wren/channel-email: routes

Services: 13.

## CallBookings (service)

File: packages/channel-email/src/restate/call-bookings.ts

- **ingest** `unknown` → `BookingOutcome | null` (plain): writes pipeline.deals, pipeline.instances, public.call_bookings, public.enrollments, public.messages, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.suppression_events, public.suppressions; reads pipeline.shape_versions, public.companies, public.contact_candidates, public.leads, public.people, public.reach_contacts, public.runs, public.social_handles, public.touches
- **ingestFor** `{ client: string; body: unknown }` → `BookingOutcome | null` (plain): writes pipeline.deals, pipeline.instances, public.call_bookings, public.enrollments, public.messages, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.suppression_events, public.suppressions; reads pipeline.shape_versions, public.clients, public.companies, public.contact_candidates, public.leads, public.people, public.reach_contacts, public.runs, public.social_handles, public.touches

## CallBriefs (service)

File: packages/channel-email/src/calls/restate.ts

- **build** `{ client?: string | null; id: number }` → `{ built: boolean; }` (serviceHandler): writes public.call_briefs; reads calendar.bookings, public.call_bookings, public.companies, public.company_checks, public.documents, public.enrichments, public.enrollments, public.findings, public.imports, public.leads, public.messages, public.people, public.person_lookups, public.research_signals, public.runs, public.sms_contacts, public.sms_messages, public.social_handles, public.thread_events, public.touches
- **send** `SendAsk` → `{ sent: boolean; why: string; } | { sent: boolean; why?: never; }` (serviceHandler): writes public.call_briefs; reads calendar.bookings, public.call_bookings, public.companies, public.company_checks, public.documents, public.enrichments, public.enrollments, public.findings, public.imports, public.leads, public.messages, public.people, public.person_lookups, public.research_signals, public.runs, public.sms_contacts, public.sms_messages, public.social_handles, public.thread_events, public.touches

## Disposition (object)

File: packages/channel-email/src/restate/disposition.ts

- **approve** `{ id: number; body?: string | null }` → `ApproveOutcome` (exclusiveHandler): writes public.call_invites, public.messages; reads public.companies, public.contact_candidates, public.enrollments, public.imports, public.leads, public.people, public.runs, public.thread_events
- **classify** `void` → `ClassifyOutcome` (exclusiveHandler): writes public.call_invites, public.messages, public.runs, public.thread_events; reads public.companies, public.contact_candidates, public.enrollments, public.findings, public.imports, public.leads, public.people, public.person_facts, public.social_handles, public.template_versions, public.templates, public.touches
- **drop** `{ id: number }` → `{ state: string }` (exclusiveHandler): writes public.call_invites, public.messages; reads public.enrollments, public.runs, public.thread_events
- **followUp** `{ enrollmentId: number; body: string; campaign?: string | null }` → `{ ok: boolean; reason: string | null; until: string | null }` (exclusiveHandler): writes public.marketing_sends, public.messages; reads public.companies, public.contact_candidates, public.enrollments, public.leads, public.message_settings, public.people, public.profile_keys, public.profiles, public.runs, public.suppressions
- **reply** `{ threadEventId: number; body: string }` → `{ ok: boolean; reason: string | null }` (exclusiveHandler): writes public.messages; reads public.companies, public.contact_candidates, public.enrollments, public.leads, public.people, public.runs, public.suppressions, public.thread_events
- **status** `void` → `ClassifyOutcome | null` (sharedHandler)

## EmailConsole (service via `portalService`)

File: packages/channel-email/src/restate/console.ts

- **answers** `PortalRequest` → `{ id: number; state: "booked" | "sent" | "booking" | "dropped" | "proposed" | "already_booked" | "needs_you"; email: string; start: Date | null; timeZone: string | null; detail: string | null; createdAt: Date; words: string | null; snippet: string | null; draft: string | null; }[]` (serviceHandler): reads public.call_invites, public.client_members, public.clients, public.enrollments, public.messages, public.roles, public.runs, public.thread_events
- **approve** `InviteRequest` → `{ ok: true; state: import("../schema.js").CallInviteState; said: string | null; reply: import("../index.js").ReplyOutcome | null; }` (serviceHandler): writes public.call_invites, public.messages; reads public.client_members, public.clients, public.companies, public.contact_candidates, public.enrollments, public.imports, public.leads, public.people, public.roles, public.runs, public.thread_events
- **callBrief** `CallsRequest` → `{ done: string[]; }` (serviceHandler): writes public.call_briefs; reads calendar.bookings, public.call_bookings, public.client_members, public.clients, public.companies, public.company_checks, public.documents, public.enrichments, public.enrollments, public.findings, public.imports, public.leads, public.messages, public.people, public.person_lookups, public.research_signals, public.roles, public.runs, public.sms_contacts, public.sms_messages, public.social_handles, public.thread_events, public.touches
- **callClear** `CallsRequest` → `{ changed: number; done: string[]; }` (serviceHandler): writes public.call_bookings; reads public.client_members, public.clients, public.enrollments, public.messages, public.roles
- **callNoShow** `CallsRequest` → `{ changed: number; done: string[]; }` (serviceHandler): writes public.call_bookings; reads public.client_members, public.clients, public.enrollments, public.messages, public.roles
- **callNotFit** `CallsRequest` → `{ changed: number; done: string[]; }` (serviceHandler): writes public.call_bookings; reads public.client_members, public.clients, public.enrollments, public.messages, public.roles
- **callNotYet** `CallsRequest` → `{ changed: number; done: string[]; }` (serviceHandler): writes public.call_bookings; reads public.client_members, public.clients, public.enrollments, public.messages, public.roles
- **callWon** `CallsRequest` → `{ changed: number; done: string[]; }` (serviceHandler): writes public.call_bookings; reads public.client_members, public.clients, public.enrollments, public.messages, public.roles
- **dossier** `PortalRequest & { id?: unknown }` → `import("@wren/research/dossier").DossierBrief` (serviceHandler): reads public.changes, public.client_members, public.clients, public.companies, public.company_checks, public.custom_field_values, public.custom_fields, public.documents, public.enrichments, public.findings, public.imports, public.people, public.person_lookups, public.roles, public.runs
- **drop** `InviteRequest` → `{ state: string; }` (serviceHandler): writes public.call_invites, public.messages; reads public.client_members, public.clients, public.enrollments, public.roles, public.runs, public.thread_events
- **killSwitchOff** `CampaignsRequest` → `Done` (serviceHandler): writes public.campaign_controls; reads public.client_members, public.clients, public.email_campaign_records, public.roles
- **killSwitchOn** `CampaignsRequest` → `Done` (serviceHandler): writes public.campaign_controls; reads public.client_members, public.clients, public.email_campaign_records, public.roles
- **pause** `SenderRequest` → `{ paused: string[]; }` (serviceHandler): writes public.sender_pauses
- **recordsExport** `PortalRequest & ExportAsk` → `import("@wren/core/records/serve").RecordsFile` (serviceHandler): reads public.client_members, public.clients, public.custom_field_values, public.custom_fields, public.draft_events, public.draft_outcomes, public.draft_people, public.roles
- **recordsGet** `PortalRequest & GetAsk` → `import("@wren/core/records/serve").RecordAnswer` (serviceHandler): reads public.changes, public.client_members, public.clients, public.custom_field_values, public.custom_fields, public.roles, public.runs
- **recordsList** `PortalRequest & ListAsk` → `import("@wren/core/records/serve").RecordsPage` (serviceHandler): reads public.client_members, public.clients, public.custom_field_values, public.custom_fields, public.roles
- **recordsStats** `PortalRequest & StatsAsk` → `import("@wren/core/records/serve").RecordsStat` (serviceHandler): reads public.client_members, public.clients, public.custom_field_values, public.custom_fields, public.roles
- **recordsTypes** `PortalRequest` → `import("@wren/core/records").RecordMeta[]` (serviceHandler): reads public.client_members, public.clients, public.roles
- **resume** `SenderRequest` → `{ resumed: string[]; }` (serviceHandler): writes public.sender_pauses
- **resumeOpeners** `CampaignsRequest` → `Done` (serviceHandler): writes public.campaign_controls; reads public.client_members, public.clients, public.email_campaign_records, public.roles
- **setCampaign** `CampaignRequest` → `{ updatedAt: Date; campaign: string; updatedBy: string; openersPerDay: number | null; killSwitch: boolean | null; }` (serviceHandler): writes public.campaign_controls; reads public.client_members, public.clients, public.email_campaign_records, public.roles
- **stopOpeners** `CampaignsRequest` → `Done` (serviceHandler): writes public.campaign_controls; reads public.client_members, public.clients, public.email_campaign_records, public.roles

## InboxPush (object)

File: packages/channel-email/src/restate/inbox-scheduler.ts

- **claim** `string` → `void` (exclusiveHandler)
- **listen** `PushListener` → `void` (exclusiveHandler)
- **notify** `void` → `void` (sharedHandler)

## ListmonkIntake (service)

File: packages/channel-email/src/restate/listmonk.ts

- **post** `ListmonkMessage` → `{ ok: true }` (serviceHandler): writes public.consent_events, public.consents, public.marketing_sends; reads public.message_settings, public.profile_keys, public.profiles, public.suppressions, public.topics

## ListmonkMail (object)

File: packages/channel-email/src/restate/listmonk.ts

- **send** `ListmonkMessage` → `IssueSent` (exclusiveHandler): writes public.consent_events, public.consents, public.marketing_sends; reads public.message_settings, public.profile_keys, public.profiles, public.suppressions, public.topics

## MailAccess (service via `portalService`)

File: packages/channel-email/src/access/console.ts

- **addMailbox** `?` → `?` (serviceHandler): writes public.client_accounts, public.setup_runs; reads public.account_facts, public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **check** `?` → `?` (serviceHandler): writes public.setup_runs; reads public.account_facts, public.client_accounts, public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **connect** `?` → `?` (serviceHandler): writes public.client_accounts, public.mail_grants, public.setup_runs; reads public.account_facts, public.client_members, public.clients, public.grants, public.mail_consents, public.operators, public.role_grants, public.roles
  - outside: npm @wrenautomation/autobrowse
- **consent** `?` → `?` (serviceHandler): writes public.mail_grants; reads public.account_facts, public.client_accounts, public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.setup_runs
  - outside: npm @wrenautomation/autobrowse
- **done** `?` → `?` (serviceHandler): writes watch.mail; reads public.client_members, public.clients, public.roles
- **mail** `?` → `?` (serviceHandler): reads public.account_facts, public.client_accounts, public.client_members, public.clients, public.grants, public.mail_connections, public.mail_consents, public.operators, public.role_grants, public.roles, public.setup_runs

## MailCallback (service)

File: packages/channel-email/src/access/console.ts

- **land** `z.infer<typeof LANDING>` → `{ ok: boolean; said: string; }` (serviceHandler): writes public.mail_connections, public.mail_consents, public.mail_grants, public.setup_runs; reads public.account_facts, public.client_accounts, public.clients
  - outside: npm @wrenautomation/autobrowse

## Marketing (service)

File: packages/channel-email/src/restate/marketing.ts

- **confirm** `Visit & { token: string }` → `{ ok: boolean; prefs: { channel: "email" | "sms"; topic: string | null; named: string | null; from: string | null; address: string; everything: boolean; frequency: "as_sent" | "weekly" | "monthly"; pausedUntil: Date | null; topics: { name: string; publicName: string; line: string; cadence: string; on: boolean; }[]; }; }` (serviceHandler): writes public.consent_events, public.consents, public.suppression_events, public.suppressions; reads public.clients, public.topics
- **prefs** `{ token: string }` → `{ channel: "email" | "sms"; topic: string | null; named: string | null; from: string | null; address: string; everything: boolean; frequency: "as_sent" | "weekly" | "monthly"; pausedUntil: Date | null; topics: { name: string; publicName: string; line: string; cadence: string; on: boolean; }[]; }` (serviceHandler): reads public.clients, public.consents, public.suppressions, public.topics
- **set** `Visit & { token: string; change: Change }` → `{ prefs: { channel: "email" | "sms"; topic: string | null; named: string | null; from: string | null; address: string; everything: boolean; frequency: "as_sent" | "weekly" | "monthly"; pausedUntil: Date | null; topics: { name: string; publicName: string; line: string; cadence: string; on: boolean; }[]; }; event: number | null; }` (serviceHandler): writes pipeline.deals, pipeline.instances, public.consent_events, public.consents, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.suppression_events, public.suppressions; reads pipeline.shape_versions, public.clients, public.topics
- **signUp** `SignUpRequest` → `{ ok: true }` (serviceHandler): writes pipeline.deals, pipeline.instances, public.consent_events, public.consents, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles; reads pipeline.shape_versions, public.suppressions, public.topics

## Newsletter (object)

File: packages/channel-email/src/restate/newsletter.ts

- **send** `Issue` → `IssueRun` (exclusiveHandler): writes public.consent_events, public.consents, public.marketing_sends; reads public.message_settings, public.profile_keys, public.profiles, public.suppressions, public.topics

## QueueRefresh (service)

File: packages/channel-email/src/restate/queue-refresh.ts

- **all** `void` → `Record<string, RefreshStats>` (serviceHandler): writes public.messages, public.runs, public.template_versions, public.templates; reads public.companies, public.contact_candidates, public.enrollments, public.findings, public.leads, public.people, public.person_facts, public.site_pages, public.social_handles, public.touches

## Resolution (object)

File: packages/channel-email/src/restate/resolution.ts

- **build** `{ limitPeople?: number } & ClientInput` → `import("../resolution/service.js").BuildCandidatesStats` (exclusiveHandler): writes public.candidate_mints, public.contact_candidates, public.runs; reads public.companies, public.imports, public.leads, public.people, public.sightings, public.verifications
- **queue** `QueueOptions & ClientInput` → `import("../resolution/service.js").QueueStats` (exclusiveHandler): writes public.contact_candidates, public.runs; reads public.leads, public.people, public.person_facts, public.suppressions
- **resolve** `ResolveInput` → `ResolutionStats` (exclusiveHandler): writes pipeline.deals, pipeline.instances, public.companies, public.contact_candidates, public.import_errors, public.imports, public.leads, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.runs, public.sightings, public.verifications; reads pipeline.shape_versions, public.people, public.suppressions
- **resolveNewDomains** `ResolveNewInput` → `ResolutionStats` (exclusiveHandler): writes pipeline.deals, pipeline.instances, public.companies, public.contact_candidates, public.import_errors, public.imports, public.leads, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.runs, public.sightings, public.verifications; reads pipeline.shape_versions, public.people, public.suppressions
- **verifyLeads** `VerifyLeadsInput` → `VerificationStats` (exclusiveHandler): writes public.contact_candidates, public.leads, public.runs, public.verifications; reads public.companies, public.contact_outcomes, public.enrollments, public.imports, public.people, public.suppressions
  - outside: npm mailifier
