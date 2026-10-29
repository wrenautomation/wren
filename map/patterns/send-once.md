---
type: pattern
covers: ["@wren/core/src/send-verdict.ts", "@wren/core/src/maybe-sent.ts", "@wren/outreach/src/settle-send.ts"]
rule:
  when: { reaches: ["SiteClient.call(_, !GET)"] }
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

kestrel `patterns` layer: a route whose walk makes a site write (`SiteClient.call` with a method that is not `GET`; a method in a variable counts) also calls one of `withSendKey`, `sendOnce`, `deliveryOf`, `maybeSent`. The walk ends at an injected call, so a key set in a callee service is not seen: approve such a route as an exception.
