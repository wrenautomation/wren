# @wren/sites: routes

Services: 1.

## Sites (service)

File: packages/sites/src/service.ts

- **serve** `Parameters<typeof api.serve>[0]` → `Served` (serviceHandler)
- **serveForm** `Parameters<typeof api.serveForm>[0]` → `Served` (serviceHandler)
- **track** `Parameters<typeof api.track>[0]` → `{ kept: boolean; }` (serviceHandler)
- **hop** `Parameters<typeof api.hop>[0]` → `{ kept: boolean; }` (serviceHandler)
- **form** `FormRequest` → `Answer` (serviceHandler)
