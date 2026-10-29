# @wren/watch: routes

Services: 1.

## WatchConsole (service via `portalService`)

File: packages/watch/src/console.ts

- **addRule** `RuleRequest` → `{ id: string; words: string; }` (serviceHandler)
- **done** `IdsRequest` → `{ done: string[]; }` (serviceHandler)
- **hide** `LikeRequest` → `{ done: string[]; rules: number; }` (serviceHandler)
- **removeRule** `IdsRequest` → `{ done: string[]; }` (serviceHandler)
- **show** `LikeRequest` → `{ done: string[]; rules: number; }` (serviceHandler)
- **sort** `IdsRequest` → `{ drop?: number; show?: number; hold?: number; done: string[]; }` (serviceHandler)
- **undone** `IdsRequest` → `{ done: string[]; }` (serviceHandler)
