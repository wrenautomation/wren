---
type: process
status: verified
verified: 2026-09-28 @ 28823cd
consumes: ["[[leads/company]]", "[[leads/person]]", "[[platform/settings]]"]
produces: ["[[research/discovery-attempt]]", "[[research/document]]", "[[research/enrichment]]", "[[research/contact-candidate]]", "[[research/verification]]", "[[leads/lead]]"]
---

# pool-feed

The research chain, one bounded stage per pass, until every stage reports nothing; then the pool of proven leads is what compose may draw on.

## Input → Movement → Output

Companies of one niche with a domain or a guessable name. `PoolScheduler/{niche}` calls, in order, `discover, verify, crawl, render, scan, extract, pick, applyPicks, resolveMailboxes, verifyMailboxes`, each one call to its own Restate object, journaled. Output is leads with `status = verified` (role inboxes and picked people) and the evidence rows beneath them.

## Why this shape

Spend is opt-in by stage (`WREN_POOL_MODEL_STAGES`: none | pick | all) and the two mailbox stages run only with a free verifier; a paid verifier resolves by hand (`pool-scheduler.ts:1`). Who to reach stays a person's call: `Resolution.queue` is never run by the loop.

## Steps

1. Stage list and the spend gate (`packages/channel-email/src/restate/pool-scheduler.ts:45`–`51`, `:179`–`:181`).
2. `Discovery.discover/verify` (`packages/research/src/discovery/service.ts`, attempts at `:96`).
3. `Enrichment.crawl/render` store documents (`packages/research/src/enrichment/crawler.ts:133`, `render.ts:156`).
4. `Enrichment.scan/extract/pick` propose (`email-scan.ts:245`, `store.ts:50`); `applyExtractions/applyPicks` dispose.
5. `Resolution.resolveNewDomains/verifyLeads` prove mailboxes; one new-domain walk at a time across workers (advisory lock, `packages/channel-email/src/restate/resolution.ts:269`), since each walk holds a pool as wide as its concurrency (`packages/channel-email/src/resolution/service.ts:899`; verdicts `:518`, `:566`; promotion `:739`). `verifyMailboxes` also re-checks proven addresses older than the verification horizon at companies that may come back for another sequence (`pool-scheduler.ts:220`; `packages/channel-email/src/verification/service.ts:107`).

## If you change this

- **Hits:** every research card; the queue-keeper's pool (`[[processes/compose]]`); `verification_yield`
- **Does not hit:** enrollments already composed

## Surfaces

| Surface | Role |
|---|---|
| `PoolScheduler/{niche}` | runs daily, then hourly while work remains |
| `wren email status` | reads |

## See

- Objects: [[research/contact-candidate]], [[research/verification]]
- Source: `packages/channel-email/src/restate/pool-scheduler.ts`
