---
type: object
cluster: clients
universe: live
status: verified
verified: 2026-10-01 @ f342d75
entity: packages/delivery/src/schema.ts:33
---

# engagement

One offer we sell to one client, with dates (schema `delivery` in main). It carries the plan's steps (`milestones`), the timeline (`updates`), deliverables, asks and results. The portal's Home reads all of it.

## Why this shape

It sits in main, beside the registry, so an operator can read across clients and the client's own database stays product data. Every row hangs off the engagement and the engagement hangs off the client, so deleting the client deletes everything. Every write names the client, and another client's id comes back as "not found". Internal and hidden updates are filtered in one place (`seenBy`); an operator viewing as the client (`asClient`, `seesInternal` in core) gets the client's filter.

## Shape

- Tables: `engagements`, `milestones`, `updates`, `deliverables`, `asks`, `results` (`packages/delivery/src/schema.ts:33`, `:61`, `:93`, `:130`, `:176`, `:209`)
- Planned dates never move. A slip moves only `due_on` and needs a reason.
- A new deliverable version is a new row pointing at the old one (`previous_id`). Home shows only the latest.
- `startEngagement` turns the offer's `plan` into dated steps and opens its asks (`packages/delivery/src/index.ts:139`, `datedPlan` `:129`)
- Writes: `postUpdate`, `hideUpdate`, `addDeliverable`, `decideDeliverable`, `addAsk`, `answerAsk`, `markDone`, `slipMilestone`, `recordResult` (`:207`–`:383`)
- Reads: `deliveryHome`, `timeline`, both through `seenBy` (`:465`, `:576`, `:410`)
- Input checks at the edge: https links only, Loom links on a Loom host, files only under `clients/<id>/` (`:63`, `:76`)
- Portal service `DeliveryPortal` (`packages/delivery/src/service.ts:253`). Clients may `answer` and `decide`. Everything else is team-only. Writes go in one transaction under `setAuditActor` (`:81`).
- Who sees which client: `pickClient` / `pickForWrite` (`packages/core/src/portal.ts:51`, `:63`). These are shared with every product's portal service.

Citations: `packages/delivery/src/schema.ts:33`, `packages/delivery/src/index.ts:139`, `packages/delivery/src/service.ts:81`, `packages/core/src/portal.ts:51`

## Connected to

- **owned-by:** [[clients/client]] (cascade)
- **joins:** [[platform/offer]] (`plan`, `measures`), [[clients/client-member]] (who reads it), [[platform/audit-log]] (every table audited)
- **looks-like-but-is-not:** [[reactivation/handoff]] (a product's per-meeting record; it may post into delivery, never the other way)

## If you change this

- **Hits:** the portal's Home and its Worker route list (`packages/delivery/src/routes.ts`), the worker's service list (`apps/worker/src/services.ts:414`), [[processes/migrate]]
- **Does not hit:** client databases. Products import delivery; delivery imports no product.

## Surfaces

| Surface | Role |
|---|---|
| app.wrenautomation.com `/api/delivery/*` | reads; clients answer and decide; operators write the rest |
| demo host | reads the demo client's sample, writes nothing |
| portal `work` module (`apps/portal/web/src/modules/work/`) | the client's pages; operators write in place, "view as client" drops internal |
| `wren --client <id> delivery …` (`apps/cli/src/delivery.ts`) | the team's writes from the terminal and the skill |

## See

- Design: `designs/2026-09-30-client-delivery-portal.md`
- Tests: `packages/delivery/test/integration/delivery.test.ts`
