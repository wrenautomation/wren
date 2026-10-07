---
type: object
cluster: email
universe: live
status: verified
verified: 2026-10-07 @ 2cdad29
entity: packages/channel-email/src/schema.ts:692
---

# call-brief

The one-screen brief a rep reads before a booked call (designs/2026-10-07-close-brief-outcome.md). Table `call_briefs`, one row per call. Shop part `calls.brief`.

## Why this shape

A rep must trust every line, so code gathers every fact and cites its source and date; a line with no date is dropped (`calls/brief.ts:402`). The model only writes questions, and code checks them: short, a question, no link, no number the facts don't hold, nothing already asked (`calls/brief.ts:352`). It is kept per call so the page loads fast, and rebuilt before the call so facts are fresh. The ping carries a link, never the lead's words, to keep the notifier's counts-only rule.

## Shape

- `call_booking_id` (PK and FK to [[email/call-booking]], cascade), `brief` jsonb (`CallBrief`: call, top, cameIn, thread, facts, posts, signals, questions, built, model), `built_at`, `start` (the call time it was built for), `sent_at`, `model` (`schema.ts:692`)
- built from: the enrollment and first email, the email link, texts, our calendar's booking source, replies' own words, the dossier (facts, `recentPosts`), `research_signals` of the last 90 days. A dated finding shows once, under Signals
- spine: `calls.brief` is the `brief.calls` node's step in `close`; it builds, keeps, and queues `CallBriefs/send` `leadMinutes` before the start (`calls/restate.ts:83`)
- service `CallBriefs{build, send}` (`calls/restate.ts:133`): `send` skips a cancelled or moved call, rebuilds, pings the team's lane ("Call in N min: brief ready" with a link), marks `sent_at`; `build` is the page's Rebuild (through `EmailConsole.callBrief`), never pings
- settings `calls.brief`: `leadMinutes` (60), `questions` (true), `ping` (true); `{}` is valid (`calls/settings.ts`)
- read by `briefOf` (`calls/brief.ts:517`): the kept one, else one built live by code, unsaved

Citations: `packages/channel-email/src/calls/brief.ts:402`, `packages/channel-email/src/calls/restate.ts:83`, `apps/worker/src/services.ts:1183`

## Connected to

- **joins:** [[leads/touch]] ("Earlier touches" part and lines in the question context)
- **owned-by:** [[email/call-booking]]
- **joins:** [[platform/spine]] (`close`), [[platform/llm-client]] (questions, through the gateway), [[platform/notifier]] (the ping), [[research/signal]]
- **looks-like-but-is-not:** the research dossier (`wren dossier`): the brief reads it, cites it, and adds the thread and how they came in

## If you change this

- **Hits:** the call page's extras (`apps/portal/web/src/modules/calls/brief.tsx`) on Inbox > Calls, a client's Calls, Calendar > Calls and the Schedule panel; the worker's `CallBriefs` binding and `calls.brief` step (`apps/worker/src/services.ts:1128`)
- **Does not hit:** anything a lead receives

## Surfaces

| Surface | Role |
|---|---|
| call page (portal) | reads; Rebuild |
| team lane (Discord) | gets the ping with a link |

## See

- Source: `packages/channel-email/src/calls/`
- Design: `designs/2026-10-07-close-brief-outcome.md`
