---
type: pattern
covers: ["@wren/core/src/send-verdict.ts", "@wren/core/src/maybe-sent.ts", "@wren/outreach/src/settle-send.ts"]
rule:
  when: { tags: ["effect:sends", "effect:posts"], reaches: ["SiteClient.call(_, !GET)"] }
  must: [withSendKey, sendOnce, deliveryOf, maybeSent]
---

# send-once (a claim, a key, a verdict)

Every send of ours that must go out at most once: claim a row, send under a key, read the verdict.

## Why

2026-10-16 (`designs/2026-10-16-maybe-sent.md`): two Reddit thread comments went out, Restate retried a journaled error, and the rows stayed `queued`, free to post again. A claim row makes a second call refuse. The key lets autobrowse answer the same verdict for the same send.

## Shape

- Claim: a `send_attempts` row, `sending` before the call ([[content/send-attempt]]).
- Key: `withSendKey(key, fn)`; each site write in it carries `writeKey`.
- Verdict: `sent`, `not_sent` or `unknown` (`SendVerdict`), as a value, never as words. `sendOnce` maps it to an outcome.
- Across a service: the callee answers a `Delivery` (`deliveryOf`, `delivered`), as a thrown error loses its type.
- Settle: `markPosted`, `unsureItem`, `dropItem` (`settle-send.ts`). Unknown waits in To approve ("May have gone out").

## Uses

- Comments on others' posts (`onpost:<id>`), thread comments, DMs, keyword DMs, posts of ours. The item kinds list is in [[content/send-attempt]].

## Rule

kestrel `patterns` layer: a route whose form says it sends to a person or posts (`effect: "sends"` or `"posts"`) and whose walk makes a site write (`SiteClient.call`, a method not `GET`) also calls one of `withSendKey`, `sendOnce`, `deliveryOf`, `maybeSent`. A site write with no such effect (an ad's status, a like, a follow, a read sent as POST) is not a send: a second one changes nothing. The walk ends at an injected call, so a key set in a callee service is not seen: approve such a route as an exception.

## Accepted exceptions

Each declares `effect: "sends"` and makes a site write with no key. A second call changes nothing, so no key is needed (2026-10-29):

- `ReachDesk/actOnPost`: a like or a follow on a post's author.
- `ReachDesk/followPerson`: a follow.
- `ReachDesk/withdrawInvite`: a withdraw of one pending invite.
- `ReachDesk/invites`: the sweep's withdraws. The invites themselves go out from the tick, under `sendOnce`.
