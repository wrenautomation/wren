---
type: object
cluster: clients
universe: live
status: verified
verified: 2026-10-07 @ 9de93f8c
entity: packages/delivery/src/health/schema.ts:30
---

# client-health

Each running client's health score, a row a day (`delivery.health_days`), from four parts: results against plan, engagement, sentiment and money. Wren's rating and an override sit beside it (`health_ratings`, `health_overrides`).

## Why this shape

A row a day, kept forever, so the trend and any past score can be read back and checked. Each row carries its weights, each part's why in words, each input's age and the rows behind it (`inputs`), so every number opens what made it. A missing part hands its weight to the rest instead of counting as zero. A person's override never replaces the model's score: both are stored, the shown score is `override ?? model` (`shownScore`), and the override stands until cleared.

## Shape

- Tables: `health_days` (pk client and day), `health_ratings` (Wren's 1 to 5 with a note), `health_overrides` (one open per client, reason required) (`packages/delivery/src/health/schema.ts:30`, `:72`, `:95`)
- Arithmetic, pure (`packages/delivery/src/health/score.ts`): `WEIGHTS` 40/20/25/15 (`:11`), `STALE_DAYS` results 14, sentiment 21 (`:19`), `bandOf` 70 healthy, 40 watch, under 40 risk (`:24`), `combine` (`:119`), `shownScore` (`:134`)
- Reads: `readHealth` (`packages/delivery/src/health/pass.ts:89`) for running, non-demo clients with `delivery.portal`: results from the engagement's `results` against the offer's plan, engagement from portal visits, decisions and answers, sentiment from weekly pulses and Wren's rating, money from overdue invoices
- `healthPass` (`pass.ts:375`) writes today's row and finds health's flags: at risk, a drop of 15 in a week (`DROP`), results well ahead of plan
- Hand: `rateClient`, `overrideHealth`, `clearOverride` (`packages/delivery/src/health/hand.ts:18`, `:36`, `:58`)
- Views (`packages/delivery/src/health/views.ts`): `console_health` (latest day, live override, weakest part under 70, open flags) `:32`, `console_health_days` `:90`, `console_health_inputs` `:118`
- Records `console.health`, `console.health_day`, `console.health_input` (`packages/delivery/src/health/records.ts:38`, `:93`, `:124`); writes through `HealthConsole` (`packages/delivery/src/health/console.ts:65`, `:155`), team only, demo refused

Citations: `packages/delivery/src/health/schema.ts:30`, `packages/delivery/src/health/pass.ts:375`, `packages/delivery/src/health/score.ts:119`

## Connected to

- **owned-by:** [[clients/client]] (cascade)
- **joins:** [[clients/engagement]] (results, asks, decisions, pulses, invoices), [[clients/client-member]] (visits), [[clients/client-flag]] (health's flags)
- **looks-like-but-is-not:** the ops board's risks (`opsBoard`, live problems for one look, not a score)

## If you change this

- **Hits:** [[processes/delivery-watch]] (scores each pass), the Clients app pages, `apps/cli/src/health.ts`, `packages/delivery/test/integration/health.test.ts`, `packages/delivery/src/health/score.test.ts`
- **Does not hit:** client databases; the client never sees its score

## Surfaces

| Surface | Role |
|---|---|
| Clients app: Health list and detail, Overview tiles, each client's Health section (`apps/portal/web/src/modules/wren/health.tsx`, `index.ts`) | reads; rate, set by hand, back to the model |
| Wren's home, "Client health" (`HealthNow`, `apps/portal/web/src/App.tsx`) | at-risk clients and urgent risks |
| `wren health sync|show|history|rate|override|clear-override` (`apps/cli/src/health.ts`) | reads and writes from the terminal |

## See

- Design: `designs/2026-10-07-health.md`
- Tests: `packages/delivery/test/integration/health.test.ts`
