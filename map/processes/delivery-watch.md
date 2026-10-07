---
type: process
status: verified
verified: 2026-10-07 @ 9de93f8c
consumes: ["[[clients/engagement]]", "[[clients/client-member]]"]
produces: ["[[clients/engagement]]", "[[clients/client-health]]", "[[clients/client-flag]]", "[[ledger/run]]"]
---

# delivery-watch

Each hour, every live project's people get the mail they asked for, each client is scored, and anything that could lose or grow a client goes on the flags list.

## Input → Movement → Output

Onboarding and active engagements of non-demo clients with `delivery.portal` installed (review asks need `delivery.reviews`, due-invoice mail `delivery.invoices`, the signed copy `delivery.contract`; a project's start installs all four) (activity flags and the digest: active only) and their members; the demo's sample. `DeliveryWatch/fleet` (`packages/delivery/src/watch.ts:1346`) runs one pass an hour in a `runs` row: welcomes, "needs you" mail, the Friday digest from `portal@`, then health and flags: urgent flags at once, the rest in one digest a day. Off until `wren delivery watch start`; runs only when `WREN_PORTAL_ORIGIN` is set, mails only when `WREN_PORTAL_FROM` and `WREN_PORTAL_MAILBOX` are too.

## Why this shape

One pass over the database finds everything, so a missed hour costs nothing: the next pass sees the same rows. What was mailed is a timestamp per person (`member_mail.told_through`), so a new ask is sent once even if passes overlap. Problems are flags (`delivery.flags`, [[clients/client-flag]]) keyed by client, project and cause, so one stays open while true, clears itself when it isn't, and reminds at most weekly (design risk 5, alert fatigue).

## Steps

1. `keepSampleFresh` (`sample.ts`): the demo's sample project (`seedSample`, `sample.ts:53`) is reseeded when missing or over a week old, so it never shows a late step.
2. `watchPass` (`watch.ts:212`): live engagements, people with their level.
3. `mailContracts` (`watch.ts:488`): a signed contract not yet mailed goes to the signer, every owner and Wren, with the signature and fingerprint; `mailed_at` marks it.
4. `mailPeople` (`watch.ts:556`): welcome once; level `all` gets new asks, deliverables and Wren's comments since `told_through`; Friday after 15:00 (send zone) everyone not `off` gets `digestOf` (`watch.ts:765`) once (`digest_on`). A failed send keeps the mark, so it retries next pass.
5. `problems` (`watch.ts:872`): quiet 3 business days, step past due, ask overdue, pulse ≤3, nobody signed in 14 days, a client comment with no Wren reply after it (one per thread), an invoice unpaid past its due day (on any engagement, running or not). Onboarding ones get paperwork flags only: contract unsigned 3 days, signed with a setup fee and no setup invoice on record, access declined or unanswered 3 days. `flagClients` (`watch.ts:1169`) syncs them as `delivery` flags (`syncFlags`, `health/flags.ts:51`) with new reviews and interests (`heardFlags`, `watch.ts:410`: an interest or a 4-5 review is an opportunity, 2 or lower an urgent risk). Then `healthPass` scores each client for the day (`health/pass.ts:375`, [[clients/client-health]]) and syncs its `health` flags; `failingRuns` (`watch.ts:1182`, the worker's `failures` dep over `failedRuns`) syncs each client's failed workflow runs as `workflows` flags and keeps Wren's own as digest lines; `tellFlags` (`health/flags.ts:203`) sends urgent ones now and the rest in one digest after 09:00, once a day (`flag_digests`); `flagsToFire` (`:317`) hands raised and cleared flags to the spine.
6. An invite or a signature through the portal kicks a pass (`service.ts`, `watched`), so a welcome lands in seconds.
7. The ops board (`opsBoard`, `watch.ts:1245`) reads the same `problems` on demand, so the board's risks and the flags never disagree.

## Surfaces

| Surface | Role |
|---|---|
| `wren delivery watch start/stop/status/sync` | the loop |
| `wren health sync` (`apps/cli/src/health.ts`) | health's pass and flags now, no alerts |
| Clients app: Health, Flags (`apps/portal/web/src/modules/wren/health.tsx`) | the scores and the one flags list |
| portal Account → Your settings (`delivery/mail`); the mail's footer links there | each person's level |
| portal Home pulse, digest links `?pulse=N&e=ID` (`delivery/pulse`) | the weekly tap |
| `delivery/board` (operators only; no page since the console standard's S2, the Clients app lists `console.client`) | every client: phase, next date, last update, open asks, last seen, pulse, risks |

## See

- Objects: [[clients/engagement]], [[clients/client-member]], [[clients/client-health]], [[clients/client-flag]]
- Design: `designs/2026-09-30-client-delivery-portal.md` (D8–D10), `designs/2026-10-07-health.md`
- Tests: `packages/delivery/test/integration/watch.test.ts`, `health.test.ts`
