# @wren/sites: routes

Services: 2.

## Sites (service)

File: packages/sites/src/service.ts

- **form** `FormRequest` → `Answer` (serviceHandler)
- **hop** `Parameters<typeof api.hop>[0]` → `{ kept: boolean; }` (serviceHandler)
- **serve** `Parameters<typeof api.serve>[0]` → `Served` (serviceHandler)
- **serveForm** `Parameters<typeof api.serveForm>[0]` → `Served` (serviceHandler)
- **track** `Parameters<typeof api.track>[0]` → `{ kept: boolean; }` (serviceHandler)

## SitesConsole (service via `portalService`)

File: packages/sites/src/console.ts

- **add** `?` → `?` (serviceHandler)
- **approve** `?` → `?` (serviceHandler)
- **ask** `?` → `?` (serviceHandler)
- **create** `?` → `?` (serviceHandler)
- **decline** `?` → `?` (serviceHandler)
- **detail** `?` → `?` (serviceHandler)
- **draft** `?` → `?` (serviceHandler)
- **duplicate** `?` → `?` (serviceHandler)
- **formCreate** `?` → `?` (serviceHandler)
- **formDetail** `?` → `?` (serviceHandler)
- **formPublish** `?` → `?` (serviceHandler)
- **formRetire** `?` → `?` (serviceHandler)
- **formSave** `?` → `?` (serviceHandler)
- **formSplitSave** `?` → `?` (serviceHandler)
- **formSplitShip** `?` → `?` (serviceHandler)
- **formSplitStart** `?` → `?` (serviceHandler)
- **formSplitStop** `?` → `?` (serviceHandler)
- **formUnpublish** `?` → `?` (serviceHandler)
- **forms** `?` → `?` (serviceHandler)
- **linkCreate** `?` → `?` (serviceHandler)
- **linkTargets** `?` → `?` (serviceHandler)
- **notes** `?` → `?` (serviceHandler)
- **offers** `?` → `?` (serviceHandler)
- **recordsExport** `?` → `?` (serviceHandler)
- **recordsGet** `?` → `?` (serviceHandler)
- **recordsList** `?` → `?` (serviceHandler)
- **recordsStats** `?` → `?` (serviceHandler)
- **recordsTypes** `?` → `?` (serviceHandler)
- **retire** `?` → `?` (serviceHandler)
- **retireAsk** `?` → `?` (serviceHandler)
- **rewrite** `?` → `?` (serviceHandler)
- **save** `?` → `?` (serviceHandler)
- **share** `?` → `?` (serviceHandler)
- **splitShip** `?` → `?` (serviceHandler)
- **splitStart** `?` → `?` (serviceHandler)
- **splitStop** `?` → `?` (serviceHandler)
- **splitWeights** `?` → `?` (serviceHandler)
