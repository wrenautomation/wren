---
type: object
cluster: research
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-email/src/schema.ts:85
---

# contact-candidate

A guessed or scraped email address for a person, ranked by evidence, waiting to be verified. Table `contact_candidates`.

## Why this shape

Minting is free and never verifies; queueing is an explicit operator step; only `runResolution` spends credits, domain by domain, best candidate first (`packages/channel-email/src/resolution/service.ts:155`, `:280`, `:899`). The `evidence` tier and `pattern` are what the walk orders by.

## Shape

- `person_id`, `email`, `domain`, `evidence` (scraped | derived_pattern | guessed_pattern), `pattern`, `rank`, `state` (candidate | queued | verified | rejected), `source_ref`, `lead_id` (`packages/channel-email/src/schema.ts:88`–`98`)

- A listed contact's candidate is born with `lead_id` set: the lead's verdict settles it (`candidate → verified | rejected` in `runVerification`), and `queueCandidates` skips it (`packages/channel-email/src/resolution/listed.ts`)

Citations: `packages/channel-email/src/schema.ts:85`

## Connected to

- **owned-by:** [[leads/person]]
- **owns:** [[research/verification]] (`contact_candidate_id`)
- **produces:** [[leads/lead]] on promotion (`resolution/service.ts:739`)
- **looks-like-but-is-not:** [[leads/lead]] (a candidate is not sendable)

## If you change this

- **Hits:** `packages/channel-email/src/resolution/service.ts:255`; the address provenance pinned on [[email/message]] (`packages/channel-email/src/outreach/provenance.ts`); `rejections_by_reason` and `verification_yield` views
- **Does not hit:** role-inbox enrollments (they come from the email pick, not from candidates)

## Surfaces

| Surface | Role |
|---|---|
| `Resolution.build/queue/resolve` | write |
| `wren email contacts` (listed contacts) | write |
| `runVerification` (lead verdict) | settles linked candidates |
| `PoolScheduler` (free verifier only) | drives |

## See

- Source: `packages/channel-email/src/resolution/service.ts`
