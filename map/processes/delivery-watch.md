---
type: process
status: verified
verified: 2026-10-01 @ c4ad6b7
consumes: ["[[clients/engagement]]", "[[clients/client-member]]"]
produces: ["[[clients/engagement]]", "[[ledger/run]]"]
---

# delivery-watch

Each hour, every live project's people get the mail they asked for, and the operator hears about any client who could feel forgotten.

## Input → Movement → Output

Active engagements of non-demo clients and their members; the demo's sample. `DeliveryWatch/fleet` (`packages/delivery/src/watch.ts:648`) runs one pass an hour in a `runs` row: welcomes, "needs you" mail, the Friday digest from `portal@`, then one notifier message listing new problems. Off until `wren delivery watch start`; runs only when `WREN_PORTAL_ORIGIN` is set, mails only when `WREN_PORTAL_FROM` and `WREN_PORTAL_MAILBOX` are too.

## Why this shape

One pass over the database finds everything, so a missed hour costs nothing: the next pass sees the same rows. What was mailed is a timestamp per person (`member_mail.told_through`), so a new ask is sent once even if passes overlap. Pings are rows (`delivery.pings`) so each problem pings once a week at most and clears itself (design risk 5, alert fatigue).

## Steps

1. `keepSampleFresh` (`sample.ts`): the demo's sample project (`seedSample`, `sample.ts:53`) is reseeded when missing or over a week old, so it never shows a late step.
2. `watchPass` (`watch.ts:134`): live engagements, people with their level.
3. `mailPeople` (`watch.ts:155`): welcome once; level `all` gets new asks, deliverables and Wren's comments since `told_through`; Friday after 15:00 (send zone) everyone not `off` gets `digestOf` (`watch.ts:284`) once (`digest_on`). A failed send keeps the mark, so it retries next pass.
4. `problems` (`watch.ts:372`): quiet 3 business days, step past due, ask overdue, pulse ≤3, nobody signed in 14 days, a client comment with no Wren reply after it (one per thread), an invoice unpaid past its due day (on any engagement, running or not). `pingOperator` (`watch.ts:485`) sends them. Rows no longer true are deleted; new or 7-day-old ones go in one notice, recorded only if it sent.
5. An invite through the portal kicks a pass (`service.ts`, `watched`), so a welcome lands in seconds.
6. The ops board (`opsBoard`, `watch.ts:551`) reads the same `problems` on demand, so the board's risks and the pings never disagree.

## Surfaces

| Surface | Role |
|---|---|
| `wren delivery watch start/stop/status/sync` | the loop |
| portal Account → Your settings (`delivery/mail`); the mail's footer links there | each person's level |
| portal Home pulse, digest links `?pulse=N&e=ID` (`delivery/pulse`) | the weekly tap |
| portal `/ops/clients` (`delivery/board`, operators only) | every client: phase, next date, last update, open asks, last seen, pulse, risks |

## See

- Objects: [[clients/engagement]], [[clients/client-member]]
- Design: `designs/2026-09-30-client-delivery-portal.md` (D8–D10)
- Tests: `packages/delivery/test/integration/watch.test.ts`
