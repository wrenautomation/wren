---
type: object
cluster: clients
universe: live
status: verified
verified: 2026-10-07 @ 9de93f8c
entity: packages/delivery/src/health/schema.ts:131
---

# client-flag

One risk or opportunity about a client (`delivery.flags`), with an owner, raised, addressed and cleared. The one list: DeliveryWatch's problems, health's findings, new reviews and interests, and a person's own.

## Why this shape

One list so nothing is tracked twice. A machine flag is keyed by client, project and cause (`uq_flags_open`), so it stays open while its cause holds and clears itself when it goes; a person's flag clears by hand. Cleared flags stay, with who and when. Addressed keeps a flag open but quiet. Alerts read the list: urgent ones go at once, the rest in one digest a day (`flag_digests`), so nobody gets a message per row.

## Shape

- Tables: `flags` (side, source `delivery` | `health` | `workflows` | `person`, cause, what, how, urgent, owner, remind days, raised/addressed/cleared with who), `flag_digests` (`packages/delivery/src/health/schema.ts:131`, `:192`)
- `syncFlags` (`packages/delivery/src/health/flags.ts:51`) raises, rewords and clears a source's flags; `raiseFlag`, `ownFlag`, `addressFlag`, `clearFlag` (`:117`, `:153`, `:162`, `:181`)
- Source `workflows` (migration 0177): DeliveryWatch syncs one risk per client workflow with failed runs (`workflowFlags`, cause `workflow:<id>`, remind daily, the top error in `how`); Wren's own failed runs ride the digest as lines (`failedLines`, the `wren` argument of `tellFlags`), and a day with only those still sends ("Workflows: N failing").
- `tellFlags` (`:203`): urgent now, digest after `DIGEST_HOUR` (`:25`) once a day, reminders by `remind_days`; `flagsToFire` (`:317`) sends each raise and clear to the spine as an event
- View `console_flags` (`packages/delivery/src/health/views.ts:149`); record `console.flag` (`packages/delivery/src/health/records.ts:171`). Its Mine view is open and addressed flags whose owner is the signed-in person (`mine: "owner"`, [[platform/records]]); the Clients Overview counts it on the "Flags I own" tile

Citations: `packages/delivery/src/health/schema.ts:131`, `packages/delivery/src/health/flags.ts:51`

## Connected to

- **owned-by:** [[clients/client]] (cascade), optionally [[clients/engagement]] (cascade)
- **joins:** [[clients/client-health]] (health's flags), [[platform/spine]] (flag events), [[platform/audit-log]] (team-only in `clientChanges`)
- **looks-like-but-is-not:** setup alerts ([[platform/account-setup]], vendor facts, not clients)

## If you change this

- **Hits:** [[processes/delivery-watch]], the Clients app Flags page and Overview, `HealthNow`, `apps/cli/src/health.ts`, `packages/delivery/test/integration/watch.test.ts`, `health.test.ts`
- **Does not hit:** the client's portal; clients never see flags

## Surfaces

| Surface | Role |
|---|---|
| Clients app: Flags, a client's Flags tab (`apps/portal/web/src/modules/wren/index.ts`, `CLIENT_FLAG_ACTIONS` in `health.tsx`) | reads; raise, take, assign, address, clear |
| notifier lane | urgent flags and the daily digest |
| `wren flags list|raise|own|address|clear` (`apps/cli/src/health.ts`) | the terminal |

## See

- Design: `designs/2026-10-07-health.md`
- Tests: `packages/delivery/test/integration/health.test.ts`, `watch.test.ts`
