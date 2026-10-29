# @wren/reactivation: routes

Services: 2.

## CrmRun (object)

File: packages/reactivation/src/crm-run.ts

- **lookup** `CrmLookupRequest` → `CrmSliceResult<CrmLookupStats>` (exclusiveHandler)
- **redraft** `CrmRedraftRequest` → `CrmSliceResult<RedraftStats>` (exclusiveHandler)
- **run** `CrmRunRequest` → `CrmRunResult` (exclusiveHandler)
- **settle** `CrmSettleRequest` → `CrmSliceResult<SettleStats & { byName: boolean }>` (exclusiveHandler)

## ReactivationPortal (service via `portalService`)

File: packages/reactivation/src/portal/service.ts

- **approve** `Req<"approve">` → `ReviewResult` (plain)
- **book** `Req<"book">` → `Done` (plain)
- **called** `Req<"called">` → `Done` (plain)
- **change** `Req<"change">` → `Done` (plain)
- **emails** `Req<"emails">` → `EmailsPage` (plain)
- **importPreview** `Req<"importPreview">` → `import("./import.js").ImportPreview` (plain)
- **importRun** `Req<"importRun">` → `import("./import.js").ImportResult` (plain)
- **overview** `Req<"overview">` → `Overview` (plain)
- **person** `Req<"person">` → `PersonView` (plain)
- **recordsExport** `Req<"recordsExport">` → `RecordsFile` (plain)
- **recordsGet** `Req<"recordsGet">` → `RecordAnswer` (plain)
- **recordsList** `Req<"recordsList">` → `RecordsPage` (plain)
- **recordsStats** `Req<"recordsStats">` → `RecordsStat` (plain)
- **recordsTypes** `Req<"recordsTypes">` → `RecordMeta[]` (plain)
- **run** `Req<"run">` → `RunPage` (plain)
- **settle** `Req<"settle">` → `Done` (plain)
- **skip** `Req<"skip">` → `ReviewResult` (plain)
- **unapprove** `Req<"unapprove">` → `ReviewResult` (plain)
- **unbook** `Req<"unbook">` → `Done` (plain)
- **uncalled** `Req<"uncalled">` → `Done` (plain)
- **work** `Req<"work">` → `WorkView` (plain)
