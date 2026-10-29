# @wren/reactivation: routes

Services: 1.

## CrmRun (object)

File: packages/reactivation/src/crm-run.ts

- **lookup** `CrmLookupRequest` → `CrmSliceResult<CrmLookupStats>` (exclusiveHandler)
- **redraft** `CrmRedraftRequest` → `CrmSliceResult<RedraftStats>` (exclusiveHandler)
- **run** `CrmRunRequest` → `CrmRunResult` (exclusiveHandler)
- **settle** `CrmSettleRequest` → `CrmSliceResult<SettleStats & { byName: boolean }>` (exclusiveHandler)
