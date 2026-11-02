---
type: process
status: verified
verified: 2026-11-02 @ 3ab0d2c0 + WA-999 phase 3 (campaign sweeps)
consumes: ["[[platform/campaign]]", "[[leads/lead]]", "[[leads/person]]", "[[email/template]]", "[[email/sequence]]", "[[email/roster]]", "[[email/send-policy]]", "[[platform/offer]]"]
produces: ["[[email/enrollment]]", "[[email/message]]"]
---

# compose

The queue-keeper: keep enough approved openers ahead of what the fleet may send, composed through the niche's plan, so nobody composes by hand and the send loops never starve.

## Input → Movement → Output

Verified leads of a niche, for companies never enrolled (first contact) and then for companies that came back (returning: rested, under the yearly cap, new sequence+offer), the niche's templates and plan, the roster's active senders. `ComposeScheduler/{niche}` fills company time zones, measures tomorrow's capacity, counts approved openers not yet sent, and composes the shortfall rule by rule, first contact first, then returning, one company per transaction, auto-approved. Output: enrollments with every step rendered as `messages`.

## Why this shape

The whole sequence renders before anything can send; a missing fact refuses the draft rather than sending "Hi ,". Partial unique indexes make a retry cost one company, not the run. A `sec_ria` hold means this loop is never started for that niche.

## Steps

1. Fill `companies.timezone` (`packages/starling/channels/email/src/restate/compose-scheduler.ts:116`; `send/lead-timezone.ts:110`).
2. Capacity and shortfall (`compose-scheduler.ts:116`, `:87`).
3. Campaigns first (`campaignSweeps`, `compose-scheduler.ts`): each live metro campaign whose `accounts.email` is a niche sender, in body order, from that inbox, on the plan rules that pitch its offer, the people in its segment, under `capLeft` of its `email.opener` cap; then the default, all senders and rules ([[platform/campaign]]). Each enrollment carries its campaign (null = default).
4. `compose()` per plan rule and audience (`packages/starling/channels/email/src/outreach/compose.ts:417`): person pass, then role-inbox pass. The person pass takes companies best-ranked first (`bestReachableFirst`: the best `role_rank` among people with an address), so a limited day reaches owners before untitled registry contacts. The audience gate is `audienceGate` (`packages/starling/channels/email/src/recontact.ts:123`); a person whose newest lookup finding is `job_change` or `left` at confidence 0.8 or more is skipped and the firm falls to its next person (`compose.ts:151`); addresses that ended wrong_person, referral, bounced or opted_out are skipped (`compose.ts:503`, `:553`); so is a lead whose [[research/lead-check]] says wrong person (mailbox fits a colleague, or moved on; `outreach/provenance.ts:217`).
5. Facts from `factsFor` (`outreach/facts.ts:125`); render (`outreach/templates.ts`); provenance (`outreach/provenance.ts:66`).
6. Insert enrollment and messages, store the template version (`compose.ts:689`, `:767`, `:836`, `:841`).

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
- Source: `packages/starling/channels/email/src/restate/compose-scheduler.ts`
