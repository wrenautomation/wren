# @wren/pipeline: routes

Services: 1.

## Journeys (service)

File: packages/pipeline/src/restate.ts

- **open** `OpenRequest` → `{ journey: string; node: string; }` (serviceHandler)
- **move** `MoveRequest` → `{ journey: string; from: string; to: string; status: "open" | "dropped" | "done"; }` (serviceHandler)
- **drop** `DropRequest` → `{ journey: string; node: string; }` (serviceHandler)
- **assign** `AssignRequest` → `restate.RestatePromise<{ journey: string; owner: string | null; }>` (serviceHandler)
- **rebuild** `RebuildRequest` → `restate.RestatePromise<import("./moves.js").Rebuilt>` (serviceHandler)
