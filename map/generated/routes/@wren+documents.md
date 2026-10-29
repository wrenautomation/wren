# @wren/documents: routes

Services: 2.

## Documents (service)

File: packages/documents/src/service.ts

- **act** `Req & { act: "sign" | "decline"; fields: Record<string, string> }` → `Answer` (serviceHandler): writes public.doc_events, public.docs; reads public.client_domains, public.client_members, public.clients, public.custom_field_values, public.custom_fields, public.custom_values, public.doc_templates, public.pay_links, public.roles
- **cancel** `{ id: string; by?: string | null }` → `{ done: boolean; why?: never; did?: never; } | { done: boolean; why: string; did?: never; } | { done: boolean; did: "cancelled" | "kept" | "deleted"; why?: never; }` (serviceHandler): reads public.clients, public.doc_templates, public.docs
- **deposit** `Req` → `Answer` (serviceHandler): writes public.doc_events, public.docs, public.pay_links; reads public.clients, public.custom_field_values, public.custom_fields, public.custom_values, public.doc_templates, public.vendor_modes
  - outside: npm stripe
- **pdf** `Req` → `Answer` (serviceHandler): writes public.doc_events, public.docs; reads public.clients, public.custom_field_values, public.custom_fields, public.custom_values, public.doc_templates, public.pay_links
  - outside: npm pdf-lib
- **send** `{ id: string; remind?: boolean | null; by?: string | null }` → `{ sent: boolean; url: null; why?: never; } | { sent: boolean; why: string; url: null; } | { sent: boolean; url: string; why?: never; }` (serviceHandler): writes public.doc_events, public.docs, public.sms_contacts, public.sms_messages; reads public.client_domains, public.clients, public.companies, public.custom_fields, public.custom_values, public.doc_templates, public.documents, public.people, public.runs, public.sms_numbers, public.suppressions
  - outside: npm libphonenumber-js, pdf-lib
- **serve** `Req` → `Answer` (serviceHandler): writes public.doc_events, public.docs; reads public.clients, public.custom_field_values, public.custom_fields, public.custom_values, public.doc_templates, public.pay_links
- **signed** `{ event: string; payload: object }` → `{ ok: boolean; why: string; ignored?: never; } | { ok: boolean; why?: never; ignored?: never; } | { ok: boolean; ignored: string; why?: never; }` (serviceHandler): writes public.doc_events, public.docs; reads public.client_domains, public.client_members, public.clients, public.doc_templates, public.roles

## DocumentsConsole (service via `portalService`)

File: packages/documents/src/console.ts

- **approve** `IdsRequest` → `{ done: string[]; }` (serviceHandler): writes public.doc_events, public.docs, public.sms_contacts, public.sms_messages; reads public.client_domains, public.client_members, public.clients, public.companies, public.custom_fields, public.custom_values, public.doc_templates, public.documents, public.grants, public.operators, public.people, public.role_grants, public.roles, public.runs, public.sms_numbers, public.suppressions
  - outside: npm libphonenumber-js, pdf-lib
- **create** `?` → `?` (serviceHandler): writes public.doc_counters, public.doc_events, public.docs; reads public.client_members, public.clients, public.companies, public.custom_field_values, public.custom_fields, public.custom_values, public.doc_templates, public.documents, public.people, public.roles, public.sms_contacts, public.sms_numbers
  - outside: npm libphonenumber-js
- **decline** `?` → `?` (serviceHandler): writes public.docs; reads public.client_members, public.clients, public.doc_templates, public.grants, public.operators, public.role_grants, public.roles
- **duplicate** `?` → `?` (serviceHandler): writes public.doc_counters, public.doc_events, public.docs; reads public.client_members, public.clients, public.doc_templates, public.roles
- **pdf** `IdRequest & { part?: string | null }` → `{ name: string; url: string; base64?: never; } | { name: string; base64: string; url?: never; }` (serviceHandler): reads public.client_members, public.clients, public.doc_events, public.doc_templates, public.docs, public.roles
  - outside: npm pdf-lib
- **recordsExport** `PortalRequest & ExportAsk` → `import("@wren/core/records/serve").RecordsFile` (serviceHandler): reads public.client_members, public.clients, public.custom_field_values, public.custom_fields, public.doc_events, public.doc_templates, public.docs, public.draft_events, public.draft_outcomes, public.draft_people, public.pay_links, public.roles
- **recordsGet** `PortalRequest & GetAsk` → `import("@wren/core/records/serve").RecordAnswer` (serviceHandler): reads public.changes, public.client_members, public.clients, public.custom_field_values, public.custom_fields, public.doc_events, public.doc_templates, public.docs, public.pay_links, public.roles, public.runs
- **recordsList** `PortalRequest & ListAsk` → `import("@wren/core/records/serve").RecordsPage` (serviceHandler): reads public.client_members, public.clients, public.custom_field_values, public.custom_fields, public.doc_events, public.doc_templates, public.docs, public.pay_links, public.roles
- **recordsStats** `PortalRequest & StatsAsk` → `import("@wren/core/records/serve").RecordsStat` (serviceHandler): reads public.client_members, public.clients, public.custom_field_values, public.custom_fields, public.doc_events, public.doc_templates, public.docs, public.pay_links, public.roles
- **recordsTypes** `PortalRequest` → `import("@wren/core/records").RecordMeta[]` (serviceHandler): writes public.doc_templates; reads public.client_members, public.clients, public.doc_events, public.docs, public.pay_links, public.roles
- **remind** `IdRequest` → `{ id: string; }` (serviceHandler): writes public.doc_events, public.docs, public.sms_contacts, public.sms_messages; reads public.client_domains, public.client_members, public.clients, public.companies, public.custom_fields, public.custom_values, public.doc_templates, public.documents, public.people, public.roles, public.runs, public.sms_numbers, public.suppressions
  - outside: npm libphonenumber-js, pdf-lib
- **send** `IdRequest` → `{ docs: { id: string; status: string; }[]; url: null; why?: never; } | { docs: { id: string; status: string; }[]; url: string | null; why: string | null; }` (serviceHandler): writes public.doc_events, public.docs, public.sms_contacts, public.sms_messages; reads public.client_domains, public.client_members, public.clients, public.companies, public.custom_field_values, public.custom_fields, public.custom_values, public.doc_templates, public.documents, public.grants, public.operators, public.people, public.role_grants, public.roles, public.runs, public.sms_numbers, public.suppressions
  - outside: npm libphonenumber-js, pdf-lib
- **templateArchive** `?` → `?` (serviceHandler): writes public.doc_templates; reads public.client_members, public.clients, public.roles
- **templateSave** `?` → `?` (serviceHandler): writes public.doc_templates; reads public.client_members, public.clients, public.roles
- **templates** `PortalRequest` → `{ templates: { id: string; kind: string; name: string; body: string; lines: import("./lines.js").DocLine[]; depositPct: number | null; expiresDays: number; version: string; }[]; approves: boolean; }` (serviceHandler): reads public.client_members, public.clients, public.doc_templates, public.grants, public.operators, public.role_grants, public.roles
- **update** `?` → `?` (serviceHandler): writes public.docs; reads public.client_members, public.clients, public.companies, public.doc_templates, public.documents, public.people, public.roles, public.sms_contacts, public.sms_numbers
  - outside: npm libphonenumber-js
- **void** `IdsRequest` → `{ done: number; }` (serviceHandler): writes public.doc_events, public.docs; reads public.client_members, public.clients, public.doc_templates, public.roles
