---
type: process
status: verified
verified: 2026-10-03 @ fb87ac1
consumes: ["[[leads/company]]", "[[leads/person]]", "[[platform/settings]]"]
produces: ["[[leads/company]]", "[[leads/sighting]]", "[[ledger/import]]", "[[research/team-search]]", "[[research/discovery-attempt]]", "[[research/document]]", "[[research/enrichment]]", "[[research/social-group]]", "[[research/contact-candidate]]", "[[research/verification]]", "[[research/signal]]", "[[leads/lead]]"]
---

# pool-feed

The research chain, one bounded stage per pass, until every stage reports nothing; then the pool of proven leads is what compose may draw on.

## Input → Movement → Output

Companies of one niche with a domain or a guessable name. `PoolScheduler/{niche}` calls, in order, `adLibrary, exaSearch, fbGroups, discover, verify, crawl, render, scan, contacts, extract, pick, applyPicks, resolveMailboxes, verifyMailboxes, team, youtube, instagram, profiles, signals`, each one call to its own Restate object, journaled. Output is leads with `status = verified` (role inboxes and picked people) and the evidence rows beneath them.

A client's pool is `PoolScheduler/<client>/all` (or `<client>/<niche>`), started by hand like Wren's (`node scripts/ingress.mjs PoolScheduler/<client>/all/start`). It calls `Discovery`/`Enrichment` on the same key, which work in `wren_client_<id>`, and `Resolution/default` with `client`. Each pass reads the client's `research.lead_sheet` block from main (words, crawl hints, per-pass sizes, `verificationsPerDay`); a client gone, the demo, or the component uninstalled stops the loop. No `profiles`, no re-checks for clients (`pool-scheduler.ts`, `clientPlan`). Its runs rows land in the client's database.

## Why this shape

Spend is opt-in by stage (`WREN_POOL_MODEL_STAGES`: none | pick | all) and the two mailbox stages run only with a free verifier; a paid verifier resolves by hand (`pool-scheduler.ts:1`). `team` and `profiles` (metered Exa reads) run only with `WREN_POOL_PROFILES=true`. `profiles` also reads LinkedIn logged in when `WREN_POOL_LINKEDIN` names a research alt; that cap skips the step, not the stage. `youtube` is free and runs on Wren's niches whenever the worker has the service account. `adLibrary` is free and runs on Wren's niches with Ad Library keywords; it needs the Mac on. `fbGroups` is free, runs on Wren's niches with `groupKeywords`, and needs the Mac on too. `exaSearch` runs on Wren's niches with Exa queries and spends the Exa keys' free credit, never more. `youtubeSearch` is free and runs on Wren's niches whenever the worker has the service account. `instagram` is free and runs on Wren's niches whenever the worker has the sites client. Who to reach stays a person's call: `Resolution.queue` is never run by the loop.

## Steps

1. Stage list and the spend gate (`packages/channel-email/src/restate/pool-scheduler.ts:50`–`62`, `:205`–`:215`).
2. `Enrichment.adLibrary` adds firms before anything reads them: each due keyword of the niche (`adKeywords`, `packages/niches/src/recruiting.ts`) is one `fb-public GET /ads` on the Mac's desk (Meta's Ad Library, signed out) and one import of source `ad_library` (`packages/research/src/enrichment/ad-library.ts`). One row per ad: a firm is its ad's link domain, else `fb:<page>`; a new firm keeps its first ad as `raw` and every later ad is a sighting. A keyword is read again after 7 days; a bucket over the imports allows 48 reads a day, all at once if the pool idled (burst 48). New firms get the niche's screen. Design: `designs/2026-10-05-social-reads.md`.
3. `Enrichment.exaSearch` adds firms by niche and city from Exa's company index: each due search (the niche's `exaQueries` crossed with its `exaCities`, a city's queries together) is one `web GET /exa/companies` on the `sites` service and one import of source `exa_search` (`packages/research/src/enrichment/exa-search.ts`). One row per result, every result kept whole. A firm is its result's own site; a result on LinkedIn or a directory is keyed by that page (`li:<slug>`, `exa:<host><path>`), never dropped. A known firm gets a sighting. A search is read again after 30 days; a bucket over the imports allows 30 a day, all at once if the pool idled (burst 30). A search costs 7 mills ($0.007) of the `exa` cap, so a day is $0.21, about $6.30 a month, on the keys' free credit. A 429 or a 402 (every key spent) stops the pass; it never pays. New firms get the niche's screen. Design: `designs/2026-10-05-social-reads.md`.
3b. `Enrichment.youtubeSearch` adds firms from YouTube's channel search: each due search (the niche's `youtubeQueries`, default its `adKeywords`) is one `search.list` for channels (100 units) and one `channels.list` on their ids (1 unit), as the service account, and one import of source `youtube_search` (`packages/research/src/enrichment/youtube-search.ts`). One row per channel, the resource whole. A firm is the first site its about text links that isn't a platform, else `yt:<channel id>`. A search is read again after 30 days; a bucket over the imports allows 10 a day (1,010 of the project's 10,000 units). Spent units stop the pass. New firms get the niche's screen. Design: `designs/2026-10-05-social-reads.md`.
4. `Enrichment.fbGroups` searches Facebook groups and reads their public posts, all on the Mac's desk (`fb-public`, signed out; `packages/research/src/enrichment/fb-groups.ts`). Each due keyword of the niche (`groupKeywords`, `packages/niches/src/recruiting.ts`) is one `GET /groups`, kept whole, with its groups and a stub per post. Then reads, group by group: the About (`/groups/{group}`) before its posts (`/groups/{group}/posts/{post}`). A keyword is searched again after 7 days and an About read again after 30. Two buckets over the stored rows: 12 searches and 80 page reads a day, each burst the whole day's amount: an idle pool sleeps to the next local day, and the desk spaces each call 20 to 40s. A 429 stops the pass and writes nothing; a 4xx is kept as data. Last, every read post not yet tied to a firm (under 90 days) is mapped: by a link whose domain is a firm's, else an author who is exactly one held person, else exactly one firm name in the text. A hit is a `post` finding on the firm with the group and the whole text, via `facebook-group`. Rest stays with its group ([[research/social-group]]). Design: `designs/2026-10-05-social-reads.md`.
5. `Discovery.discover/verify` (`packages/research/src/discovery/service.ts`, attempts at `:96`).
6. `Enrichment.crawl/render` store documents (`packages/research/src/enrichment/crawler.ts:133`, `render.ts:156`). A key `niche@i/n` holds one shard, so shard keys crawl side by side; `wren enrich crawl` is the same crawl from a laptop.
7. `Enrichment.scan/extract/pick` propose (`email-scan.ts:245`, `store.ts:50`); `applyExtractions/applyPicks` dispose. `Enrichment.contacts` reads every page once for phones, LinkedIn and socials into [[research/contact-point]], free (`packages/research/src/enrichment/contacts.ts:265`).
8. `Resolution.resolveNewDomains/verifyLeads` prove mailboxes; one new-domain walk at a time across workers (advisory lock, `packages/channel-email/src/restate/resolution.ts:269`), since each walk holds a pool as wide as its concurrency (`packages/channel-email/src/resolution/service.ts:899`). A walked domain with a proven pattern comes back for people queued after its walk, one probe each; an unproven one stays out (`service.ts:774`; verdicts `:518`, `:566`; promotion `:739`). `verifyMailboxes` also re-checks proven addresses older than the verification horizon at companies that may come back for another sequence (`pool-scheduler.ts:258`; `packages/channel-email/src/verification/service.ts:107`).
9. `Enrichment.team` searches one firm's public team per call and keeps current staff as people with LinkedIn and title ([[research/team-search]]); firms with a verified inbox first, then firms with no people (`nextTeamFirms`, `pool-scheduler.ts:161`). A token bucket spreads it over the day (100 searches, burst 10); an Exa cap parks it. New people get addresses through `Resolution.build` and `queue`, by hand.
10. `Enrichment.youtube` reads the channel each firm links from its own site and its 5 newest uploads, through the YouTube Data API as Wren's service account (`packages/research/src/enrichment/youtube.ts`). The channel is a `profile` finding, each upload a `post` with its watch link, a dead or `/c/` link a missing `profile`; a firm comes back after 30 days. Firms with a mailable lead first. A bucket over the profile findings caps it near 2,000 a day (burst 1,000), and a pass waits for 100 firms of room so the loop can go idle. The newest post under 90 days becomes `post.*` facts for every niche's templates (`postFacts`, `packages/channel-email/src/outreach/facts.ts`). Design: `designs/2026-10-05-social-reads.md`.
11. `Enrichment.instagram` reads the Instagram account each firm links from its own site and its 25 newest posts, through autobrowse's `meta GET /instagram/{username}` (Graph `business_discovery`, `packages/research/src/enrichment/instagram.ts`). The account is a `profile` finding (`via instagram`, raw whole), each post a `post` with its permalink and `published_at`; an unknown or personal account (`found:false`) is a missing `profile`. A firm comes back after 30 days, mailable first. A bucket over the profile findings caps it at 300 firms a day (burst 150); a pass waits for 30 firms of room. A 429 stops the pass. `postFacts` reads YouTube posts only, so Instagram posts never open an email yet. $0.
12. `Enrichment.profiles` reads LinkedIn profiles and firm pages from Exa's cache, never linkedin.com, for the people compose reaches next: compose's own order (`nextToEnroll`, `packages/channel-email/src/outreach/compose.ts:359`), a week of the niche's opener capacity ahead (`pool-scheduler.ts:262`). One person, then their firm, written before the next (`packages/research/src/enrichment/profiles.ts:221`; handler `packages/research/src/restate/enrichment.ts:503`), then the firm's [[research/lead-check]] rows are recomputed (`recheck`, injected by the worker: research never imports channel-email). An Exa cap parks the stage, and a failed read stops the run. Google gets at most 200 searches a local day, daytime only. `wren enrich profiles` runs the same loop from a laptop (`profiles.ts:397`); `wren enrich checks --niche <n>` recomputes the checks alone, free.
13. `Enrichment.signals` runs after `profiles`, over the same queue and those people's firms ([[research/signal]]; handler `packages/research/src/restate/enrichment.ts:967`, stage `pool-scheduler.ts:515`). It runs each collector that is `on`: hiring, news, funding, stack, linkedin, talks, site and demand, all built and on by default. Each picks its due subjects, waits for a batch of room on its own bucket, then reads and writes unit by unit. Free collectors batch 20 units a step; metered ones (linkedin, demand) one. Wren's niches only. All free in cash; `demand` spends pool model calls, and `linkedin` 10 reads a day of `linkedin@alt`. Design: `designs/2026-10-06-signal-collectors.md`.

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
| `wren enrich signals --niche <n> [--dry]` | the `signals` stage by hand |
| `Enrichment/<niche>/team` | the `team` stage by hand |
| `Enrichment/<niche>/youtube` | the `youtube` stage by hand (`{"limit": n}`) |
| `Enrichment/<niche>/instagram` | the `instagram` stage by hand (`{"limit": n}`) |
| `Enrichment/<niche>/adLibrary` | the `adLibrary` stage by hand (`{"limit": n}` keywords) |
| `Enrichment/<niche>/exaSearch` | the `exaSearch` stage by hand (`{"limit": n}` searches) |
| `Enrichment/<niche>/fbGroups` | the `fbGroups` stage by hand (`{"limit": n}` searches and reads) |

## See

- Objects: [[research/contact-candidate]], [[research/verification]]
- Source: `packages/channel-email/src/restate/pool-scheduler.ts`
