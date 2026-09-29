---
type: process
status: verified
verified: 2026-09-28 @ 83459e9
consumes: ["[[content/idea]]", "[[content/platform]]", "[[content/media]]", "[[platform/llm-client]]"]
produces: ["[[content/draft]]", "[[content/content-metric]]", "[[content/idea]]"]
---

# content-loop

An idea in William's words becomes one draft per platform, a person approves, the draft posts at its slot, and what it did feeds the next draft.

## Input → Movement → Output

An idea (CLI, or minted by AdsWatch). `ContentDesk.draft` pays once per platform, journaled; the review seat approves, rejects or edits (rows, straight to Postgres); `ContentScheduler` claims due drafts and publishes through the `Content` service, which speaks each platform's API through autobrowse's `sites` (Reddit direct); `ContentMetrics` snapshots young posts daily and says what worked on Mondays; `ContentPlanner` says tomorrow's shortfall.

## Why this shape

Drafting costs money and approving is publishing, so both stay a person's call; the loops only move approved rows. A draft edited after approval goes back to `draft`. A crash between the two row moves leaves a visible `publishing` row and never posts twice.

## Steps

1. Idea (`packages/content/src/ideas.ts:24`); from ads (`packages/channel-meta/src/bridge.ts`).
2. Draft, fit-checked against `PLATFORM_SPECS` (`draft.ts:186`, `platforms.ts:23`; lessons `lessons.ts`; voice `voice.ts`).
3. Review (`review.ts:70`, `:165`, `:170`); slots (`slots.ts`).
4. Publish (`restate/scheduler.ts`; `queue.ts:37`; `packages/core/src/content/restate.ts:65`; adapters `packages/channel-*/src/content.ts`).
5. Metrics and plan (`metrics.ts:50`, `:97`; `restate/metrics.ts`; `plan.ts`; `restate/planner.ts`).

## If you change this

- **Hits:** [[content/draft]], [[content/content-metric]], the seven adapters, `walkthrough/01-content-loop.md`
- **Does not hit:** email

## Surfaces

| Surface | Role |
|---|---|
| `wren content add/draft/approve/reject/edit/results/costs` | drives |
| `ContentDesk`, `ContentScheduler`, `ContentMetrics`, `ContentPlanner`, `Content` | run |
| `TokenRenewal/box` | keeps platform tokens valid |

## See

- Objects: [[content/draft]], [[content/platform]]
- Source: `packages/content/src/restate/scheduler.ts`
