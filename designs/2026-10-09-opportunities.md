# Opportunities (2026-10-09)

Gaps item 9, first of the audit's "Next" list (product-audit.md): "Opportunities board for
clients. Owners judge us by deals they can see." GHL calls it Opportunities and Pipelines.

## Answer first

A new package, `@wren/deals`. A client (and Wren) keeps deals in pipelines of stages. The portal
gets an Opportunities app: a board with a column per stage and cards you move, plus a list with
saved views. Each move is kept, and fires `trigger.deal` on the spine so a workflow can start on
it. Code and UI only. Nothing sends.

## Data (main database)

- `deal_pipelines`: `id`, `client` (null is Wren), `name`, `stages` (jsonb, in order: `key`,
  `label`, `kind` open | won | lost), `created_*`, `updated_*`. Unique name per owner. The first
  read makes a default one: New, Contacted, Booked, Quoted, Won, Lost.
- `deals`: `id`, `client`, `pipeline`, `stage` (a key of its pipeline), `status` (open | won |
  lost, from the stage's kind), `name`, `value_cents`, `currency` (3 letters, default USD),
  `contact` (name, email, phone), `source` (manual | form | text | booking | call) and `source_ref`
  (the id it came from), `owner` (the email of who works it), `note`, `next_on` (a date to
  follow up), `moved_at`, `closed_at`, `created_*`, `updated_*`.
- `deal_moves`: `deal`, `from`, `to`, `at`, `by`. Time in a stage and the history come from here.

A pipeline's stages can be renamed, added and reordered. A stage with deals in it can't be
dropped until they move. Every pipeline keeps one won and one lost stage.

## Spine

A move fires `{ trigger: "trigger.deal", change: "moved" | "won" | "lost", stage }` with subject
`deal:<id>`. The node `trigger.deal` hears a change and, optionally, one stage key. Webhooks out
call it `deal.moved`. Creating a deal fires `moved` into its first stage.

## Portal

Opportunities app, in Wren's workspace and each client's, the same pages:

- **Board**: one column per stage, each with its count and value. A card shows the name, value,
  contact, owner, days in stage, and the next follow-up (red when past). Move by dragging, or by
  the card's stage menu on a phone. Pick the pipeline at the top.
- **Deals**: the records list. Views: Open, Mine, Follow up (next_on today or past), Stale (14
  days in one stage), Won (this month), Lost. Actions: New deal, Move, Mark won, Mark lost,
  Assign, Edit.
- **Pipelines**: a pipeline's stages edited in a form.

## Not in this round

- A deal made by a form submit, a text lead or a booking: a workflow step "Add to pipeline" on the
  spine. `source` and `source_ref` are ready for it.
- Custom fields on deals (audit item: custom fields, next).

## Decision log

- 2026-10-09: its own package, not in `@wren/sites` or `@wren/delivery`. Deals are the client's
  sales, not our delivery to them.
- 2026-10-09: main database, owner column, as pay links and forms. The board reads one place.
- 2026-10-09: status follows the stage's kind; won and lost are stages, not flags. One move path.

## Shipped

- 2026-10-09: `@wren/deals` (pipelines, deals, moves; migration 0208), DealsConsole, the Deal
  trigger and `deal.moved` webhook event, the Opportunities app in Wren's workspace and each
  client's (Board, Deals, Pipelines). Map card `map/objects/platform/deal.md`.
