---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-06 @ b801ba0
entity: packages/core/src/schema.ts:125
---

# checks (unit holds and check outcomes)

What Restate's retries miss: a unit that keeps failing, a source that keeps answering wrong, and sources that disagree. A `unit_holds` row takes a unit out of its stage's runs; a `check_outcomes` row counts one pass or fail per stage and source.

## Why this shape

A step that throws is retried; a step that returns a wrong answer counts as done. So a unit out of retries is held 7 days, tried once more, then held until a person releases it. A source under 70% passes over its last 50 outcomes (since its last release) pauses on that stage as a `source:<name>` hold. One row per outcome keeps the window exact.

## Shape

- `unit_holds` (`schema.ts:125`): unique (stage, subject); `until` = infinity when it waits for a person; `released_by` = `checks` when a later run settled it
- `check_outcomes` (`schema.ts:152`): stage, source, check, subject, ok, reason
- Views: `unit_holds_now` (`:171`, state held/due/stuck/paused/released), `check_rates` (`:190`, 30 days)
- Code: `packages/core/src/checks.ts`: `hold` (`:45`), `settle` (`:69`), `release` (`:87`), `holdsOn` (`:99`), `counted` (`:118`), `pausedSources` (`:155`)
- Restate units: `stageHolds`, `notHeld`, `unitBatches({holds})` in `packages/research/src/restate/units.ts`

## Connected to

- **joins:** [[research/enrichment]] (every loop skips held ids, holds poison units), [[research/team-search]] (counted, never pauses), [[research/lead-check]]
- **joins:** reactivation score (`whereConflict`, stage `reactivation.where`, subject `person:<id>`): a tie of sources holds the person from compose
- **looks-like-but-is-not:** domain send pauses (deliverability plain-test rate), the spine's failed steps

## If you change this

- **Hits:** enrichment and discovery selection, reactivation compose and score, the `reactivation_people` view (`now = conflict`), console Holds and Checks
- **Does not hit:** units already written

## Surfaces

| Surface | Role |
|---|---|
| Restate enrichment/discovery loops | write holds, settle on landing |
| `scoreCrmContacts` | holds and settles conflicts |
| Console > Workflows > Holds (Release) | reads, writes |
| Console > Workflows > Checks | reads |
| Portal Leads "Sources disagree" (Go with the surest reading) | writes |

## See

- Design: `designs/2026-10-05-checks.md`
