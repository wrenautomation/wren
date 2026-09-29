---
type: object
cluster: reactivation
universe: live
status: verified
verified: 2026-09-29 @ 23a6170
entity: packages/reactivation/src/schema.ts:247
---

# handoff

One warm reply passed to a recruiter: `handoffs`, one row per reply. Holds the recruiter, the forward's Message-ID, when it went, and whether a meeting was booked. A meeting booked is the billing unit.

## Why this shape

The forward's Message-ID is minted before the send, and the mailbox is asked for it before any retry, so a crash between send and mark never forwards twice. The row is locked while it is sent. Only a person marks a meeting (the recruiter in the portal, or Wren); a client login takes back only its own mark, since each is billed.

## Shape

- `handoffs` (`schema.ts:247`), unique on `thread_event_id`
- `ensureHandoff` (`handoff.ts:81`), `markMeetingBooked` (`:115`), `billOf` (`:157`)
- Forward: `forwardHandoffs` (`forward.ts:65`)

Citations: `packages/reactivation/src/schema.ts:247`, `packages/reactivation/src/forward.ts:65`

## Connected to

- **owned-by:** [[clients/client]]
- **joins:** [[email/thread-event]] (the reply), [[email/enrollment]], [[reactivation/client-profile]] (recruiter)

## If you change this

- **Hits:** the portal's bill and booking buttons, `crm loop status` (handoff line), the offer's `perUnit` ([[platform/offer]])
- **Does not hit:** the send tick (forwards bypass the outbox)

## Surfaces

| Surface | Role |
|---|---|
| `Reactivation/{client}` | writes (open, forward) |
| portal | writes (book) |

## See

- Process: [[processes/reactivation-pass]]
