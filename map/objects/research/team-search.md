---
type: object
cluster: research
universe: live
status: verified
verified: 2026-10-05 @ 4b69427
entity: packages/research/src/schema.ts:408
---

# team-search

One people search per firm: the firm's name to Exa's index of public profiles (`web` `/people`, 25 results, 7 mills), and everyone with a current role there kept as a person with their LinkedIn and title. Table `team_searches`, one row per company.

## Why this shape

One call per firm, not per person: a hit brings most of the staff for one search, and their addresses are then free guesses for Resolution to prove (designs/2026-10-05-team-search.md). The row marks the firm searched so it is never paid for twice, and keeps every profile returned, kept or not, and its `searched_at` is the spend the token bucket counts (`TEAM_BUCKET`, 100 a day, burst 10, every niche): Exa's free cap resets once a day, so the bucket spreads it instead of spending it at the reset. A held person at the firm by the same name is filled (LinkedIn, title), never doubled; a new one is `origin: linkedin`, `source_key: li:<vanity>`, the keys a LinkedIn import uses, so a profile held at another firm is a sighting (`packages/research/src/enrichment/team.ts:107`).

## Shape

- `company_id` (pk), `state` (`matched` | `unresolved` | `capped`), `query`, `profiles` (jsonb: name, url, headline, roles), `kept`, `retry_at` (a cap's lift), `run_id`, `searched_at` (`schema.ts:408`)

Citations: `packages/research/src/schema.ts:408`, `packages/research/src/people/team.ts`

## Connected to

- **owned-by:** [[leads/company]]
- **produces:** [[leads/person]] (`people`, with `linkedin_url`)
- **looks-like-but-is-not:** `company_lookups` (the firm's own LinkedIn page, `profiles` stage)

## If you change this

- **Hits:** `team.ts`, `Enrichment.team` (`packages/research/src/restate/enrichment.ts:707`), the pool's `team` stage and its order (`nextTeamFirms`, `packages/channel-email/src/restate/pool-scheduler.ts:161`)
- **Does not hit:** compose, Resolution (new people wait for `build` and `queue`)

## Surfaces

| Surface | Role |
|---|---|
| `PoolScheduler/{niche}` stage `team` (with `WREN_POOL_PROFILES`) | writes, up to 10 firms a pass, as the bucket allows |
| `Enrichment/<niche>/team {"companyIds":[...]}` | by hand |

## See

- Source: `packages/research/src/enrichment/team.ts`
