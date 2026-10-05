---
type: object
cluster: research
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-email/src/schema.ts:120
---

# verification

One verdict on one address from one verifier. Table `verifications`; the verifier behind it is the `EmailVerifier` port (`packages/channel-email/src/verification/verifier.ts:14`), in prod the mailifier SMTP prober.

## Why this shape

A verdict is evidence, not status: `valid | invalid | risky | catch_all` (`VERIFICATION_RESULTS`, `:28`). Only an authoritative verifier's `valid` moves a lead (`verification/service.ts:65`); `risky` means the server, not the mailbox, answered and is retried later. Every row keeps `raw`, so a verdict can be re-read when the prober changes.

Verdicts are public facts, so main keeps them for every client: a client's walk goes through `sharedVerdicts` (`packages/channel-email/src/verification/shared.ts`), which reuses main's `valid | invalid | catch_all` for the address under 30 days old and writes a fresh probe to main with only `email` set (`ck_verifications_attributed` allows it, migration 0081). The client's own row is still written in its database, `raw.shared` marking a reused one.

## Shape

- `lead_id` or `contact_candidate_id`, `verifier`, `result`, `raw`, `checked_at`, `email` (`packages/channel-email/src/schema.ts:123`–`130`)

Citations: `packages/channel-email/src/schema.ts:120`

## Connected to

- **owned-by:** [[leads/lead]] or [[research/contact-candidate]]
- **looks-like-but-is-not:** [[research/lead-check]] (is it the right person)
- **joins:** `verification_yield` view (`packages/channel-email/src/views.ts:103`); the address provenance on [[email/message]]

## If you change this

- **Hits:** `verification/service.ts:140`, `:170`; `resolution/service.ts:518`, `:566`; the vendor adapter `verification/mailifier.ts`; `PoolScheduler`'s `verifyMailboxes` stage
- **Does not hit:** `discovery_attempts`

## Surfaces

| Surface | Role |
|---|---|
| `Discovery.verify`, `Resolution.resolve/verifyLeads` | write |
| compose (through `leads.status`) | reads indirectly |

## See

- Source: `packages/channel-email/src/verification/service.ts`
