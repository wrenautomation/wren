---
type: object
cluster: email
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-email/src/outreach/sequences.ts:23
---

# sequence

Follow-up cadence as data: a named list of steps (template, business days after the opener), plus the niche's enrollment plan that decides which sequence a company gets.

## Why this shape

An arm is one offer and one hook, the unit an A/B is read over; a sequence's arm is where its opener lives (`sequences.ts:1`). The plan is ordered rules with fact gates, and at most one ungated rule, last (`plan.ts:73`). Both are niche data; compose and the queue-keeper read them, nothing else branches on them.

## Shape

- `Sequence`, `SequenceStep` (`sequences.ts:18`, `:23`); `armOf` (`:11`)
- `EnrollmentRule { sequence, where? }`, `enrollmentPlan` (`plan.ts:67`, `:73`)
- business-day math in `send/dates.ts`

Citations: `packages/channel-email/src/outreach/sequences.ts:23`, `plan.ts:73`

## Connected to

- **owned-by:** [[platform/niche]] (`sequences`, `plan`, `packages/niches/src/niche.ts:26`)
- **owns:** the `sequence_snapshot` on [[email/enrollment]]
- **joins:** [[email/template]]

## If you change this

- **Hits:** compose and the queue-keeper (`compose.ts:382`, `restate/compose-scheduler.ts`); the send walk's due dates; `reply_by_arm_step` (`views.ts:77`); `sops/campaign-ramp.md`
- **Does not hit:** running enrollments (snapshotted)

## Surfaces

| Surface | Role |
|---|---|
| niche definitions (`packages/niches/src/<niche>/`) | write |
| `ComposeScheduler` | reads |

## See

- Source: `packages/channel-email/src/outreach/plan.ts`
