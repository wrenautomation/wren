# @wren/pipeline: routes

Services: 1.

## Journeys (service)

File: packages/pipeline/src/restate.ts

- **assign** `AssignRequest` → `restate.RestatePromise<{ journey: string; owner: string | null; }>` (serviceHandler)
- **drop** `DropRequest` → `{ journey: string; node: string; }` (serviceHandler)
- **move** `MoveRequest` → `{ journey: string; from: string; to: string; status: "open" | "dropped" | "done"; }` (serviceHandler)
- **open** `OpenRequest` → `{ journey: string; node: string; }` (serviceHandler)
- **rebuild** `RebuildRequest` → `restate.RestatePromise<import("./moves.js").Rebuilt>` (serviceHandler)
