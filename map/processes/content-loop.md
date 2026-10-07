---
type: process
status: verified
verified: 2026-10-07 @ HEAD
consumes: ["[[content/idea]]", "[[content/comment]]", "[[content/platform]]", "[[content/media]]", "[[content/playbook]]", "[[platform/llm-client]]"]
produces: ["[[content/draft]]", "[[content/content-metric]]", "[[content/idea]]"]
---

# content-loop

An idea in William's words becomes one draft per platform, a person approves, the draft posts at its slot, and what it did feeds the next draft.

## Input → Movement → Output

An idea (CLI, or minted by AdsWatch). `ContentDesk.draft` pays once per platform, journaled; the review seat approves, rejects or edits (rows, straight to Postgres); `ContentScheduler` claims due drafts and publishes through the `Content` service, which speaks each platform's API through autobrowse's `sites` (Reddit direct); `ContentMetrics` snapshots young posts daily and says what worked on Mondays; `ContentPlanner` says tomorrow's shortfall and, with `draft` on, fills each open slot first: ideas from `nextIdea` (undrafted ideas, the day's build log, a reader's question), drafted through `ContentDesk.draft`, each new row given its slot (O5).

## Why this shape

Approving is publishing, so it stays a person's call; the loops only move approved rows. Drafting runs on the worker's LLM (Cohere, $0), so the planner may draft, but its drafts wait as `draft` like any other. A draft edited after approval goes back to `draft`. A crash between the two row moves leaves a visible `publishing` row and never posts twice.

## Steps

1. Idea (`packages/content/src/ideas.ts:24`); from ads (`packages/channel-meta/src/bridge.ts`).
2. Draft, fit-checked against `PLATFORM_SPECS` (`draft.ts:186`, `platforms.ts:23`; lessons `lessons.ts`; voice `voice.ts`).
3. Review (`review.ts:70`, `:165`, `:170`); slots (`slots.ts`).
4. Publish (`restate/scheduler.ts`; `queue.ts:37`; `packages/core/src/content/restate.ts:65`; adapters `packages/channel-*/src/content.ts`).
5. Metrics and plan (`metrics.ts:50`, `:97`; `restate/metrics.ts`; `plan.ts`; `restate/planner.ts`).
6. Daily drafts: open slots (`plan.ts:96`), next idea (`plan.ts:135`; `ideas/build-log.ts`, GitHub's public commits API, no token; `ideas/questions.ts`), fill (`restate/planner.ts:148`). Settings: `platforms`, `draft`, `slots` (`slotsOf`, `slots.ts:45`: a slot with a bad hour, minute or weekday is dropped). The plan's `waiting` counts only drafts holding a slot inside the day (`plan.ts:42`): older unapproved drafts wait in To approve and never block tomorrow. Approve without a slot takes the planner's slots, not the defaults (`ContentDesk.approve` reads `ContentPlanner/default` status; the CLI the same through ingress); a client's desk keeps the defaults.

## If you change this

- **Hits:** [[content/draft]], [[content/content-metric]], the seven adapters, `walkthrough/01-content-loop.md`
- **Does not hit:** email

## Surfaces

| Surface | Role |
|---|---|
| `wren content add/draft/approve/reject/edit/results/costs` | drives |
| `wren content planner start --draft [--slots <json>]` | turns daily drafts on |
| `wren content planner slots <platform> <HH:MM...> [--days 1-5\|2] [--clear]` | sets one platform's slots, keeps the rest, starts the planner |
| `ContentDesk`, `ContentScheduler`, `ContentMetrics`, `ContentPlanner`, `Content` | run |
| `TokenRenewal/box` | keeps platform tokens valid |

## See

- Objects: [[content/draft]], [[content/platform]]
- Source: `packages/content/src/restate/scheduler.ts`
