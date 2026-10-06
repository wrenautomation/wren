---
type: object
cluster: research
universe: live
status: verified
verified: 2026-10-06 @ a2ec8a1
entity: packages/research/src/schema.ts:228
---

# signal

A dated, linked fact about a firm or person that makes a message relevant now: news, a post, hiring, a job change, the tech stack, a site change, a talk, a demand post. Not a table: a `findings` row with `signal_at` set, read through the view `research_signals`. One collector per source writes them; `signal_checks` holds each collector's answer per subject (designs/2026-10-06-signal-collectors.md).

## Why this shape

Findings already dedupe on `fact_key`, keep the raw in `documents`, and feed briefs, scores and `postFacts`; a second table would split every reader. The database refuses a dated row with no link or of a non-signal kind. `keepFinding` dates a signal kind from its value when the writer gives no date (`signalDate`, `packages/research/src/findings.ts:75`); collectors go through `keepSignal` (`findings.ts:107`), which also refuses a draft with no raw. `signal_checks` paces each collector by its own bucket and `everyDays` without re-reading findings.

## Shape

- `findings.signal_at`, `findings.signal_dated` (`published` | `approx` | `seen`), partial index where set (`schema.ts:228`)
- view `research_signals`: id, kind, topic, company_id, person_id, subject, title, url, at, dated, via, confidence, document_id, first_seen, seen, age (`schema.ts:272`)
- `signal_checks`: pk (`collector`, `subject`), `state` (found | none | unresolved | capped), `found`, `tried`, `answer`, `retry_at`, `run_id`, `checked_at` (`schema.ts:601`). A subject is `c<id>`, `p<id>` or a post key.
- collectors: `packages/research/src/signals/` (contract `index.ts:100`, registry `collectors.ts`)

## Collectors

A collector is one file: `name`, `subject` (company, person or post), its own zod `settings`, a `bucket` (per day, burst), `everyDays`, `metered`, an optional `subjects`, and `collect`, which only reads; the runner writes (`index.ts:100`, `defineCollector` `:117`). The registry `COLLECTORS` lists all eight once (`collectors.ts:20`). Their settings join the component `research.signals` under each name, plus `on` (default: built). LinkedIn reads only as `linkedin@alt`, by name, for a client whose `WREN_POOL_LINKEDIN` is set and is not `linkedin` or `linkedin@wren` (`readAccount`, `index.ts`). Free collectors batch 20 units a step; metered ones run one a step.

| Collector | Kind | Subject | Source, in order | Every | Bucket a day (burst) | Cost | Settings |
|---|---|---|---|---|---|---|---|
| [`hiring`](../../../packages/research/src/signals/hiring.ts) | `hiring` | firm | `checkHiring`: careers page, board API, then LinkedIn jobs as `linkedin@alt`. A LinkedIn cap parks that firm only | 7 d | 150 (20) | $0 | `linkedin` (true) |
| [`news`](../../../packages/research/src/signals/news.ts) | `news` | firm | `searchEvents`: Google News RSS, Google page (50 a day of the shared budget), Exa. All 9 `NEWS_KINDS`; `crm run` keeps 4 | 30 d | 200 (20) | $0 | `kinds` (all 9) |
| [`funding`](../../../packages/research/src/signals/funding.ts) | `news`, event funding | firm | SEC EDGAR full-text search for Form D by bare name, no key | 90 d | 300 (20) | $0 | `months` (12) |
| [`stack`](../../../packages/research/src/signals/stack.ts) | `stack` | firm | stored pages and DNS TXT and MX; prints in `stack-prints.ts`. No new page reads | 30 d | 1,000 (20) | $0 | `pages` (25), `dns` (true) |
| [`linkedin`](../../../packages/research/src/signals/linkedin.ts) | `post` | person | autobrowse `linkedin GET /in/{vanity}/activity` as `linkedin@alt`, metered. A cap parks the person and stops the pass | 30 d | 10 (2) | $0 | `max` (20 items) |
| [`talks`](../../../packages/research/src/signals/talks.ts) | `talk` | person | iTunes Search, then YouTube `search.list` (100 units) only when iTunes finds nothing. Kept only when the text names the person and their firm | 90 d | 200 (20) | $0 | `youtube` (true), `youtubePerDay` (20 a Pacific day) |
| [`site`](../../../packages/research/src/signals/site.ts) | `site_change` | firm | first read Wayback CDX; later reads diff the home page and stored pages against the last version. A version already kept is never reported again | 30 d | 200 (20) | $0 | `pages` (4), `months` (12), `robots` (warn) |
| [`demand`](../../../packages/research/src/signals/demand.ts) | `demand` | post, then firm or person | `reddit_threads` under 90 days, dated `social_posts`, `reddit-public GET /search` for the niche's phrases. The pool's model reads 10 posts a call (Cohere on prod) | once | 100 (10) | $0 cash; about 19 model calls a day, 28 with a backlog, 100 at most | `phrases` (by niche), `searchesPerDay` (20), `offer` |

Citations: `packages/research/src/schema.ts:228`, `packages/research/src/signals/index.ts:232` (due), `:454` (runner), `:499` (`signalsFor`)

## Connected to

- **owned-by:** [[leads/company]], [[leads/person]]
- **produces:** `findings` rows; `signal_checks` rows
- **looks-like-but-is-not:** the lander's Signals (visitor events and replay); `crm run`'s `signals` stage (hiring, `packages/reactivation/src/signals.ts`), which writes the same `hiring` findings

## If you change this

- **Hits:** `keepFinding` (every findings writer), the backfill in the `*_signals` migration, `googleLeft` (signals take at most 50 of 200 searches, `packages/research/src/enrichment/profiles.ts`), the pool's `signals` stage, the `research.signal` record and the firm record's related list
- **Does not hit:** `factsFor`, `postFacts` (nothing is merged into them)

## Surfaces

| Surface | Role |
|---|---|
| `PoolScheduler/{niche}` stage `signals` | writes, each collector that is `on` |
| `Enrichment/<niche>/signals {"personIds":[...],"timezone":"..."}` | by hand (`packages/research/src/restate/enrichment.ts:967`) |
| `wren enrich signals --niche <n> [--collector] [--company] [--person] [--dry]` | from a laptop |
| Console Outbound, Signals (`research.signal`) | reads |
| component `research.signals` | each collector's settings and `on` |

## See

- Source: `packages/research/src/signals/`
- Design: `designs/2026-10-06-signal-collectors.md`
