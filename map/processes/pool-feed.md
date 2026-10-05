---
type: process
status: verified
verified: 2026-10-03 @ fb87ac1
consumes: ["[[leads/company]]", "[[leads/person]]", "[[platform/settings]]"]
produces: ["[[research/discovery-attempt]]", "[[research/document]]", "[[research/enrichment]]", "[[research/contact-candidate]]", "[[research/verification]]", "[[leads/lead]]"]
---

# pool-feed

The research chain, one bounded stage per pass, until every stage reports nothing; then the pool of proven leads is what compose may draw on.

## Input → Movement → Output

Companies of one niche with a domain or a guessable name. `PoolScheduler/{niche}` calls, in order, `discover, verify, crawl, render, scan, extract, pick, applyPicks, resolveMailboxes, verifyMailboxes, profiles`, each one call to its own Restate object, journaled. Output is leads with `status = verified` (role inboxes and picked people) and the evidence rows beneath them.

A client's pool is `PoolScheduler/<client>/all` (or `<client>/<niche>`), started by hand like Wren's (`node scripts/ingress.mjs PoolScheduler/<client>/all/start`). It calls `Discovery`/`Enrichment` on the same key, which work in `wren_client_<id>`, and `Resolution/default` with `client`. Each pass reads the client's `research.lead_sheet` block from main (words, crawl hints, per-pass sizes, `verificationsPerDay`); a client gone, the demo, or the component uninstalled stops the loop. No `profiles`, no re-checks for clients (`pool-scheduler.ts`, `clientPlan`). Its runs rows land in the client's database.

## Why this shape

Spend is opt-in by stage (`WREN_POOL_MODEL_STAGES`: none | pick | all) and the two mailbox stages run only with a free verifier; a paid verifier resolves by hand (`pool-scheduler.ts:1`). `profiles` (metered Exa reads) runs only with `WREN_POOL_PROFILES=true`. Who to reach stays a person's call: `Resolution.queue` is never run by the loop.

## Steps

1. Stage list and the spend gate (`packages/channel-email/src/restate/pool-scheduler.ts:50`–`62`, `:205`–`:215`).
2. `Discovery.discover/verify` (`packages/research/src/discovery/service.ts`, attempts at `:96`).
3. `Enrichment.crawl/render` store documents (`packages/research/src/enrichment/crawler.ts:133`, `render.ts:156`). A key `niche@i/n` holds one shard, so shard keys crawl side by side; `wren enrich crawl` is the same crawl from a laptop.
4. `Enrichment.scan/extract/pick` propose (`email-scan.ts:245`, `store.ts:50`); `applyExtractions/applyPicks` dispose.
5. `Resolution.resolveNewDomains/verifyLeads` prove mailboxes; one new-domain walk at a time across workers (advisory lock, `packages/channel-email/src/restate/resolution.ts:269`), since each walk holds a pool as wide as its concurrency (`packages/channel-email/src/resolution/service.ts:899`). A walked domain with a proven pattern comes back for people queued after its walk, one probe each; an unproven one stays out (`service.ts:774`; verdicts `:518`, `:566`; promotion `:739`). `verifyMailboxes` also re-checks proven addresses older than the verification horizon at companies that may come back for another sequence (`pool-scheduler.ts:258`; `packages/channel-email/src/verification/service.ts:107`).
6. `Enrichment.profiles` reads LinkedIn profiles and firm pages from Exa's cache, never linkedin.com, for the people compose reaches next: compose's own order (`nextToEnroll`, `packages/channel-email/src/outreach/compose.ts:359`), a week of the niche's opener capacity ahead (`pool-scheduler.ts:262`). One person, then their firm, written before the next (`packages/research/src/enrichment/profiles.ts:221`; handler `packages/research/src/restate/enrichment.ts:503`), then the firm's [[research/lead-check]] rows are recomputed (`recheck`, injected by the worker: research never imports channel-email). An Exa cap parks the stage, and a failed read stops the run. Google gets at most 200 searches a local day, daytime only. `wren enrich profiles` runs the same loop from a laptop (`profiles.ts:397`); `wren enrich checks --niche <n>` recomputes the checks alone, free.

## If you change this

- **Hits:** every research card; the queue-keeper's pool (`[[processes/compose]]`); `verification_yield`
- **Does not hit:** enrollments already composed
- **Client pools:** verdicts and pages are shared through main ([[research/verification]], [[research/document]]); the client's firms, people and leads stay in its database

## Surfaces

| Surface | Role |
|---|---|
| `PoolScheduler/{niche}` | runs daily, then hourly while work remains |
| `PoolScheduler/<client>/all` | a client's pool, sized by its lead sheet block |
| Portal app `leads` (client workspace) | reads the client's `email.firm`/`email.stall` through `EmailConsole.records*` |
| `wren email status` | reads |
| `wren enrich profiles --niche <n>` | the `profiles` stage by hand |

## See

- Objects: [[research/contact-candidate]], [[research/verification]]
- Source: `packages/channel-email/src/restate/pool-scheduler.ts`
