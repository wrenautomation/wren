---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-09 @ 8df889fb
entity: packages/deals/src/schema.ts:68
---

# deal

Opportunities: a sale being worked, in one stage of one pipeline, for a client or for Wren (owner null). Tables `deal_pipelines`, `deals`, `deal_moves`; service `DealsConsole`; the Opportunities app (`deals`).

## Why this shape

Main database with an owner column, as pay links and forms, so the board reads one place. Won and lost are stages with a kind, not flags: every change goes through `moveDeals`, which keeps the move and returns what the spine hears. A stage's key stays while its label changes, so workflows that name it keep working.

## Shape

- `deal_pipelines`: `client` (null is Wren), `name` (unique per owner), `stages` jsonb `{key,label,kind open|won|lost}` in board order; one won and one lost each (`parseStages`, `packages/deals/src/stages.ts`). The first look makes "Sales": New, Contacted, Booked, Quoted, Won, Lost.
- `deals`: `client`, `pipeline`, `stage` (a key), `status` (the stage's kind), `name`, `value_cents`, `currency`, `contact_name|email|phone`, `source` manual|form|text|booking|call + `source_ref`, `owner` (email), `note`, `next_on`, `moved_at`, `closed_at`. Migration `0208_deals`.
- `deal_moves`: `deal`, `from` (null on the first), `to`, `at`, `by`.
- A move fires `trigger.deal` `{change moved|won|lost, stage}` with subject `deal:<id>` (`dealFired`, `packages/deals/src/console.ts`); event kind `deal`; webhooks out `deal.moved` / `deal.won`.
- Records `deals.deal`: views Open, Mine, Follow up (`next_on` today or past), Stale (14 days in one open stage), Won, Lost, All. Wren's are served by the console (`dealRecordFor(null)`), a client's by DealsConsole.

Citations: `packages/deals/src/schema.ts`, `packages/deals/src/store.ts`, `packages/deals/src/records.ts`, `packages/deals/src/console.ts`, `packages/core/src/logic.ts` (`trigger.deal`)

## Connected to

- **owns:** `deal_pipelines`, `deals`, `deal_moves`
- **owned-by:** `@wren/deals`
- **joins:** [[clients/client]] by `client`; [[platform/spine]] (`trigger.deal`); [[platform/webhook-subscription]] (`deal.moved`, `deal.won`)
- **looks-like-but-is-not:** the Pipeline app (Wren's research funnel); call outcomes (`close`'s won, also `deal.won`)

## If you change this

- **Hits:** workflows with a Deal trigger naming a stage key, webhooks out payloads, the board and list in every workspace.
- **Does not hit:** sends. A move sends nothing; a workflow decides.

## Surfaces

| Surface | Role |
|---|---|
| Opportunities app (`apps/portal/web/src/modules/deals`) | Board (drag, or a stage menu on a phone), Deals list with views and actions, Pipelines editor |
| Workflows editor | the Deal trigger |

## See

- Source: `packages/deals/src`
- Design: `designs/2026-10-09-opportunities.md`
