# Team search: one people search per firm (2026-10-05)

## Answer first

One Exa people search per firm (`web` `/people`, firm name, 25 results, 7 mills) returns the public profiles of the people who work there: name, title, LinkedIn, every role. Everyone whose current role is at the firm becomes a person with their LinkedIn and title. Their email then costs nothing: `Resolution build` and `queue` guess it, and the pool's `resolveMailboxes` proves it on our own prober.

Before this, LinkedIn was one search per person (`profiles`), and only for people a firm's own pages named. 17.7k of 26.7k recruiting firms with a domain had no person at all.

## Measured

Six recruiting firms that have a verified inbox and no people, 2026-10-05:

| Firm | Profiles | Current role at the firm |
|---|---|---|
| 1 | 25 | 0 (a similar name) |
| 2 | 25 | 23 |
| 3 | 25 | 0 (no public staff) |
| 4 | 25 | 0 (look-alike names) |
| 5 | 25 | 1 |
| 6 | 25 | 17 |

About half the firms hit, and a hit brings most of the staff. Small firms with no public profiles stay with the per-person path and the firm's own pages.

## How it runs

- Stage `team` in `PoolScheduler/{niche}`, before `profiles`, 10 firms a pass. Metered, so it runs only when `profiles` does (`WREN_POOL_PROFILES`). A niche with a pinned stage list adds it by `start {"stages":[...]}`.
- `Enrichment/<niche>/team` by ingress for a set number of firms.
- Picks firms with a domain that were never searched, verified inboxes first.
- One row per firm in `team_searches`: `matched` (kept someone), `unresolved` (kept no one), `capped` (Exa's daily cap; `retry_at`). Every profile returned is kept on the row (name, url, headline, roles), kept or not.
- A token bucket paces it: 100 searches a day, refilled one every ~14 minutes, at most 10 at once (`TEAM_BUCKET`, counted from `team_searches`, every niche). Exa's free cap (330 mills a day per key, 3 keys, ~140 searches) resets at UTC midnight. Without the bucket the stage would spend it all in the first passes after the reset and starve the lead sheets, `profiles` and answers for the rest of the day.
- Exa's cap still parks the stage if something else spent the allowance first.

## Who is kept

- Has a LinkedIn profile link and a full name (`splitName`).
- A role marked current at the firm (`isFirm`: firm name, or the domain's label). A headline that only names the firm is not a job.
- A person we already hold at the firm by the same name (`sameName`) gets the LinkedIn and title if theirs are empty. Anyone else is a new person, `origin: linkedin`, `source_key: li:<vanity>`, the same keys as a LinkedIn import. A profile already held elsewhere is a sighting, not a second person.

## Cost

| Scope | Firms | At $0.007 |
|---|---|---|
| Bucket (free cap) | 100/day | $0 |
| Recruiting, verified inbox | 7,874 | ~79 days at $0 |
| Recruiting, any domain | 26,722 | ~267 days at $0 |

## Decision log

- One search per firm, not per person. William, 2026-10-05: "mainly email linkedin. joint search might be better for managing request costs".
- Firm name alone as the query. The HR-words query (`findContacts`) finds hiring staff at a client. Here we want the owners and leaders too.
- `people.linkedin_url` is written: the profile names the person and lists a current role at the firm, R7's rule. The `profiles` stage still reads them from the cache later ($0.001) and can overrule.
- Same switch as `profiles`, no new env flag: both spend the same Exa budget.
- The backlog drains from the free refills only, never paid. William, 2026-10-05: "the backlog can just be like a standard rate limiter bucket system where as it fills up we just use the refreshes on the free limits".
- 100 of the ~140 free searches a day go to team search; the rest is left for client lead sheets, `profiles` and answers, which share the keys.
