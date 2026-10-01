---
type: process
status: verified
verified: 2026-09-28 @ 28823cd
consumes: ["[[leads/lead]]", "[[leads/person]]", "[[email/template]]", "[[email/sequence]]", "[[email/roster]]", "[[email/send-policy]]", "[[platform/offer]]"]
produces: ["[[email/enrollment]]", "[[email/message]]"]
---

# compose

The queue-keeper: keep enough approved openers ahead of what the fleet may send, composed through the niche's plan, so nobody composes by hand and the send loops never starve.

## Input → Movement → Output

Verified leads of a niche, for companies never enrolled (first contact) and then for companies that came back (returning: rested, under the yearly cap, new sequence+offer), the niche's templates and plan, the roster's active senders. `ComposeScheduler/{niche}` fills company time zones, measures tomorrow's capacity, counts approved openers not yet sent, and composes the shortfall rule by rule, first contact first, then returning, one company per transaction, auto-approved. Output: enrollments with every step rendered as `messages`.

## Why this shape

The whole sequence renders before anything can send; a missing fact refuses the draft rather than sending "Hi ,". Partial unique indexes make a retry cost one company, not the run. A `sec_ria` hold means this loop is never started for that niche.

## Steps

1. Fill `companies.timezone` (`packages/channel-email/src/restate/compose-scheduler.ts:116`; `send/lead-timezone.ts:110`).
2. Capacity and shortfall (`compose-scheduler.ts:116`, `:87`).
3. `compose()` per plan rule and audience (`packages/channel-email/src/outreach/compose.ts:382`): person pass, then role-inbox pass. The audience gate is `audienceGate` (`packages/channel-email/src/recontact.ts:123`); addresses that ended wrong_person, referral, bounced or opted_out are skipped (`compose.ts:467`, `:517`).
4. Facts from `factsFor` (`outreach/facts.ts:110`); render (`outreach/templates.ts`); provenance (`outreach/provenance.ts:66`).
5. Insert enrollment and messages, store the template version (`compose.ts:598`, `:682`, `:744`, `:754`).

## If you change this

- **Hits:** [[email/enrollment]], [[email/message]]; a niche's `recontact` rest days ([[platform/niche]])
- **Does not hit:** the send tick's pacing; the inbox

## Surfaces

| Surface | Role |
|---|---|
| `ComposeScheduler/{niche}` | runs nightly |
| `wren email preview` | renders one without writing |

## See

- Objects: [[email/enrollment]], [[email/template]]
- Source: `packages/channel-email/src/restate/compose-scheduler.ts`
