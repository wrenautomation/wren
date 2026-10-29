# @wren/watch: routes

Services: 1.

## WatchConsole (service via `portalService`)

File: packages/watch/src/console.ts

- **addRule** `RuleRequest` → `{ id: string; words: string; }` (serviceHandler): writes watch.rules
- **done** `IdsRequest` → `{ done: string[]; }` (serviceHandler): writes watch.mail; reads watch.rules
- **hide** `LikeRequest` → `{ done: string[]; rules: number; }` (serviceHandler): writes watch.mail, watch.rules
- **removeRule** `IdsRequest` → `{ done: string[]; }` (serviceHandler): writes watch.rules
- **show** `LikeRequest` → `{ done: string[]; rules: number; }` (serviceHandler): writes watch.mail, watch.rules
- **sort** `IdsRequest` → `{ drop?: number; show?: number; hold?: number; done: string[]; }` (serviceHandler): writes watch.mail; reads watch.rules
- **undone** `IdsRequest` → `{ done: string[]; }` (serviceHandler): writes watch.mail; reads watch.rules
