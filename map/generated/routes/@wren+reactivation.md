# @wren/reactivation: routes

Services: 1.

## CrmRun (object)

File: packages/reactivation/src/crm-run.ts

- **run** `CrmRunRequest` → `CrmRunResult` (exclusiveHandler)
- **lookup** `CrmLookupRequest` → `CrmSliceResult<CrmLookupStats>` (exclusiveHandler)
- **redraft** `CrmRedraftRequest` → `CrmSliceResult<RedraftStats>` (exclusiveHandler)
- **settle** `CrmSettleRequest` → `CrmSliceResult<SettleStats & { byName: boolean }>` (exclusiveHandler)
