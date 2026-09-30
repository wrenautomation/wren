# Lead recycling (2026-09-30)

A company that got one cold sequence is no longer dead forever. It can get a new sequence later, once it has rested, unless it asked out.

William's ask: "having leads be dead forever after one email campaign where they either dont respond or respond negatively is unreasonable." Campaigns, offers and services change; old leads should hear the new version.

## Rules

Each finished enrollment has one **outcome**. The outcome sets how long the company rests before its next cold sequence.

| Outcome | Rest | Why |
|---|---|---|
| `no_reply` | 90 days | Never engaged; a new pitch later is fair |
| `not_now` | 90 days | Timing, not fit |
| `not_interested` | 180 days | Said no; ask again only much later |
| `wrong_person`, `referral` | 0 days | That address is done; another person at the firm may go now |
| `bounced` | 30 days | That address is done; another address may go |
| `opted_out` (unsubscribe, complaint) | never | Suppression; permanent by law |
| `warm` (interested, meeting booked) | never | A person owns it now, not cold email |
| `stopped_by_hand` | never | Someone stopped it on purpose |
| `needs_a_look` (reply not yet classified, or `other`) | held | Classify first |
| `active` | held | Still running |

Guardrails, all enforced in one SQL gate:

- **New sequence or offer.** A company never gets a sequence+offer pair it already had. Recycling only happens when there is something new to say.
- **At most 2 cold sequences per company in any 365 days.**
- **Fresh first.** The queue-keeper fills the day with first-contact companies, then tops up with returning ones.
- **Addresses re-checked.** A returning address older than the verification horizon (45 days) is re-checked by the free SMTP prober before compose can use it.
- **Addresses that failed stay out.** An address whose outcome was `wrong_person`, `referral`, `bounced` or `opted_out` is never used again, even if its company returns.
- **Reports split.** `enrollments.contact_round` (1 = first contact, 2 = second sequence, ...) rides on every enrollment; `campaign_funnel` groups by `recycled`.

Rest periods and the yearly cap are per niche (`recontact` in the niche spec), defaulting to the table above. The never and held outcomes are fixed.

## How it works

- **`contact_outcomes` view**: one row per enrollment with its `outcome` and `last_touch_at` (latest of enrolled, stopped, last send, last inbound event). Rest runs from `last_touch_at`.
- **`src/recontact.ts`** (channel-email): the policy type, defaults, and `audienceGate(company id, audience, sequence, offer, policy)`:
  - `first_contact`: the company has no enrollment at all (the old rule).
  - `returning`: it has one, every one has rested, it is under the yearly cap, and this sequence+offer is new to it.
- **Compose** takes `audience` (default `first_contact`) and the niche's `recontact`. Both passes (person, role inbox) use the gate and skip done addresses. A returning role inbox needs a fresh verdict.
- **Plan rules** take `audience?: "first_contact" | "returning"`. Absent = both. A returning-only rule is how a niche gives recycled leads their own copy.
- **Queue-keeper** (`topUp`): sweep 1 runs the plan for first contact; sweep 2 runs it again for returning companies with what is left of the shortfall.
- **Pool-feeder**: `verifyMailboxes` also re-checks the stale addresses of companies that may return (`recheckReturning`).
- **`wren email status`**: the pool line shows fresh and may-return counts; the funnel line splits first/recycled.

## Law (US, Canada)

- **CAN-SPAM** (US): no consent needed for B2B cold email; opt-outs must be honored forever. Suppressions never expire, so this holds.
- **CASL** (Canada): implied consent for a conspicuously published business address, relevant to the role. That does not expire with time. Unsubscribes are permanent.
- Not in scope: UK/EU (no leads there).

## Decision log

- **2026-09-30** Recycling on, defaults as in the table. William may change rest periods per niche.
- **2026-09-30** Company-level rest, not person-level: one firm hearing from us twice in a month reads as spam even if the people differ. `wrong_person`/`referral` are the exception (rest 0) because the firm told us to try someone else.
- **2026-09-30** Recycle only with a new sequence+offer. The same email twice is noise, and it keeps copy work tied to recycling.
- **2026-09-30** Nothing sends until William restarts the loops (campaign wind-down).
