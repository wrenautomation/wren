# @wren/reactivation: routes

Services: 2.

## CrmRun (object)

File: packages/reactivation/src/crm-run.ts

- **lookup** `CrmLookupRequest` → `CrmSliceResult<CrmLookupStats>` (exclusiveHandler): writes public.documents, public.findings, public.people, public.person_lookups, public.run_events, public.runs, public.unit_holds; reads public.clients, public.companies, public.contact_candidates, public.crm_contacts, public.imports, public.verifications
  - outside: npm tldts
- **redraft** `CrmRedraftRequest` → `CrmSliceResult<RedraftStats>` (exclusiveHandler): writes public.compositions, public.messages, public.runs, public.template_versions, public.templates; reads public.briefs, public.client_profile, public.clients, public.companies, public.enrollments, public.people, public.suppressions
- **run** `CrmRunRequest` → `CrmRunResult` (exclusiveHandler): writes pipeline.deals, pipeline.instances, public.briefs, public.companies, public.company_checks, public.company_event_checks, public.compositions, public.contact_candidates, public.contact_scores, public.documents, public.enrollments, public.findings, public.messages, public.mover_addresses, public.people, public.person_lookups, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.run_events, public.runs, public.template_versions, public.templates, public.unit_holds, public.verifications; reads pipeline.shape_versions, public.client_profile, public.clients, public.company_lookups, public.crm_contacts, public.import_errors, public.imports, public.leads, public.limits, public.signal_checks, public.suppressions
  - outside: npm @wrenautomation/falcon, @wrenautomation/weaver, tldts; hosts www.linkedin.com
- **settle** `CrmSettleRequest` → `CrmSliceResult<SettleStats & { byName: boolean }>` (exclusiveHandler): writes public.findings, public.runs; reads public.clients, public.companies
  - outside: npm tldts

## ReactivationPortal (service via `portalService`)

File: packages/reactivation/src/portal/service.ts

- **approve** `Req<"approve">` → `ReviewResult` (plain): writes public.messages; reads public.client_members, public.clients, public.enrollments, public.grants, public.operators, public.role_grants, public.roles
- **book** `Req<"book">` → `Done` (plain): writes delivery.results, delivery.updates, public.handoffs; reads delivery.engagements, delivery.milestones, public.client_members, public.client_profile, public.clients, public.enrollments, public.messages, public.people, public.roles, public.thread_events
- **called** `Req<"called">` → `Done` (plain): writes public.calls; reads public.client_members, public.clients, public.crm_contacts, public.roles
- **change** `Req<"change">` → `Done` (plain): writes public.client_profile; reads public.client_members, public.clients, public.roles
- **emails** `Req<"emails">` → `EmailsPage` (plain): reads public.client_members, public.client_profile, public.clients, public.crm_contacts, public.documents, public.enrollments, public.findings, public.messages, public.people, public.roles
- **importPreview** `Req<"importPreview">` → `import("./import.js").ImportPreview` (plain): reads public.client_members, public.clients, public.imports, public.roles
  - outside: npm csv-parse
- **importRun** `Req<"importRun">` → `import("./import.js").ImportResult` (plain): writes pipeline.deals, pipeline.instances, public.companies, public.contact_candidates, public.crm_contacts, public.import_errors, public.imports, public.people, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.sightings; reads pipeline.shape_versions, public.client_members, public.clients, public.leads, public.roles
  - outside: npm csv-parse
- **overview** `Req<"overview">` → `Overview` (plain): reads public.briefs, public.client_members, public.client_profile, public.clients, public.companies, public.company_checks, public.company_event_checks, public.compositions, public.contact_candidates, public.contact_scores, public.crm_contacts, public.enrollments, public.findings, public.grants, public.import_errors, public.imports, public.messages, public.mover_addresses, public.operators, public.people, public.person_lookups, public.role_grants, public.roles, public.suppressions, public.thread_events, public.unit_holds, public.verifications
- **person** `Req<"person">` → `PersonView` (plain): reads public.briefs, public.client_members, public.client_profile, public.clients, public.contact_scores, public.crm_contacts, public.documents, public.findings, public.people, public.roles
- **recordsExport** `Req<"recordsExport">` → `RecordsFile` (plain): reads public.changes, public.client_members, public.client_profile, public.clients, public.custom_field_values, public.custom_fields, public.draft_events, public.draft_outcomes, public.draft_people, public.imports, public.people, public.roles, public.runs
- **recordsGet** `Req<"recordsGet">` → `RecordAnswer` (plain): reads public.changes, public.client_members, public.client_profile, public.clients, public.custom_field_values, public.custom_fields, public.draft_events, public.draft_outcomes, public.draft_people, public.imports, public.people, public.roles, public.runs
- **recordsList** `Req<"recordsList">` → `RecordsPage` (plain): reads public.changes, public.client_members, public.client_profile, public.clients, public.custom_field_values, public.custom_fields, public.draft_events, public.draft_outcomes, public.draft_people, public.imports, public.people, public.roles, public.runs
- **recordsStats** `Req<"recordsStats">` → `RecordsStat` (plain): reads public.changes, public.client_members, public.client_profile, public.clients, public.custom_field_values, public.custom_fields, public.draft_events, public.draft_outcomes, public.draft_people, public.imports, public.people, public.roles, public.runs
- **recordsTypes** `Req<"recordsTypes">` → `RecordMeta[]` (plain): reads public.client_members, public.client_profile, public.clients, public.grants, public.imports, public.operators, public.role_grants, public.roles
- **run** `Req<"run">` → `RunPage` (plain): reads public.client_members, public.client_profile, public.clients, public.people, public.roles, public.run_events, public.runs
- **settle** `Req<"settle">` → `Done` (plain): writes public.contact_scores, public.unit_holds; reads public.client_members, public.clients, public.companies, public.company_checks, public.crm_contacts, public.findings, public.mover_addresses, public.people, public.roles
- **skip** `Req<"skip">` → `ReviewResult` (plain): writes public.enrollments, public.messages; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **unapprove** `Req<"unapprove">` → `ReviewResult` (plain): writes public.messages; reads public.client_members, public.clients, public.enrollments, public.grants, public.operators, public.role_grants, public.roles
- **unbook** `Req<"unbook">` → `Done` (plain): writes delivery.results, delivery.updates, public.handoffs; reads delivery.engagements, delivery.milestones, public.client_members, public.client_profile, public.clients, public.enrollments, public.messages, public.people, public.roles, public.thread_events
- **uncalled** `Req<"uncalled">` → `Done` (plain): writes public.calls; reads public.client_members, public.clients, public.roles
- **work** `Req<"work">` → `WorkView` (plain): reads public.client_members, public.client_profile, public.clients, public.companies, public.company_checks, public.contact_scores, public.documents, public.findings, public.mover_addresses, public.people, public.person_lookups, public.roles
