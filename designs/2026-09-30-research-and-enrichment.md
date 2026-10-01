# Research and enrichment (2026-09-30)

William's ask: "Research same vertical, build pipeline to generate templates and offers. Check if hiring seasons interfere with the deliverability of our lead reactivation offer. Dedicated research and enrichment pipelines … Universal lead enrichment pipeline + ultra personalized lead enrichment thing (video variants) … to support all sorts of research tasks as internal admin work / crafting out full business products and as a product itself."

Status: seasons answered and the send calendar fixed. Studies built and run on recruiting. Dossier built. Video variants built, one sample live; a batch render is William's call.

## Built

- **Holiday-aware sending** (f574e18). `WREN_SEND_HOLIDAYS`, default `us,ca,year_end`. Nothing sends on those days, the ramp does not climb, follow-ups skip them like weekends.
- **Studies** in `@wren/research/studies`. A question, or a vertical, becomes a cited report with offers and emails. Tables `studies` and `study_steps` (migration 0031). CLI `wren study new | run | report | list`.
- **Claude Code as a model.** `@wren/llm` provider `claude-code[:model]` runs `claude -p`. No key; the Claude Code login pays.
- **Dossier** in `@wren/research/dossier`. Everything we know about a firm and its people, with sources. CLI `wren dossier show <firm>` and `wren dossier export --niche <n>`.
- **Research skill** `.claude/skills/research`: Claude Code drives studies the way it drives autobrowse.
- **First study**: `designs/studies/2026-09-30-recruiting-vertical.md`. Verdict, timing, source trust, a final email.
- **SOPs deleted** (`sops/`), as asked. References now point at the copy rules in code.
- **Video variants**: a demo video per firm, its own watch page. See below.

## Hiring seasons

Question: do hiring seasons hurt the reactivation offer (20 booked meetings in 90 days)?

Yes, through slow replies and meetings slipping into January. Not through lost demand. Per-meeting pricing puts that risk on us.

BLS JOLTS, not seasonally adjusted, 2022-01 to 2026-08, divided by its own 12-month trend (100 = trend):

| Series | Jan | Feb | Oct | Nov | Dec |
|---|---|---|---|---|---|
| Hires, all | 99 | 83 | 105 | 88 | **73** |
| Hires, professional and business services | 102 | 90 | 104 | 81 | **73** |
| Openings, all | 104 | – | 105 | 96 | 93 |
| Openings, professional and business services | 109 | – | **110** | 103 | 96 |

Job orders hold up in Q4. Starts and replies drop.

- Cold email replies peak in February (0.54%) and bottom in December (0.35%). [Belkins, 7.5M emails](https://belkins.io/blog/cold-email-response-rates).
- Hires fall sharply in December and rise in January. Postings are up 14% in September and 11% in October vs March. [LinkedIn via Fortune](https://fortune.com/2026/09/05/september-surge-hiring-jobs-linkedin-indeed/).
- Staffing employment dips in the holiday weeks and rebounds late January. [ASA](https://americanstaffing.net/posts/2023/12/27/staffing-employment-seasonally-dips-in-december/).
- Budgets set Oct to Nov, jobs posted in December, hiring Jan to Feb. [Continents](https://www.continents.us/peak-hiring-season/), [PeopleKeep](https://www.peoplekeep.com/blog/when-is-hiring-season).

2026-27 calendar: Canadian Thanksgiving Oct 12. US Thanksgiving Nov 26, that week is weak. Dead from about Dec 21 to Jan 1. Restart Jan 4, strong from Jan 11.

90 days is 13 weeks. The dead stretch (about Dec 21 to Jan 1) is under 2 of them, and the holidays don't count toward the 90 days. So any start gets the same sending days. A Nov or Dec start loses some reply rate in December and gets it back in February, the best month. The dip is small. We accept it.

What to do:

1. Holidays don't count toward the 90 days: built (`windowEnd`). No skipping to January.
2. Count a meeting booked inside the 90 days even when it is held later.
3. Oct to Dec copy angle: "Q1 hiring plans", "fill your January desk".
4. Re-run job-change lookups late January. Movers become new accounts (ties to lead recycling).
5. Out-of-office replies: read "back on <date>" and hold the follow-up: built (`enrollments.away_until`).
6. Holiday calendar: built.

## Studies

A study is a question with 1 to 5 angles. Steps, each resumable per unit:

1. **plan**: the model writes search queries per angle.
2. **search**: autobrowse `web` `/search`.
3. **ask** (optional, `--ask`): Perplexity per angle, its sources read too. 100 a day.
4. **read**: autobrowse `web` `/read`. Pages are kept as `documents`; a re-run never fetches twice.
5. **claims**: the model pulls claims, each with a quote.
6. **draft**: offers and emails that cite claims.

The gate keeps the model honest:

- A claim's quote must be on the page (folded case, quotes, dashes; or each of its sentences is).
- Every number in a claim must be in its quote. A year may come from the page.
- Quotes are 5 to 80 words.
- A draft item cites at least one real claim. An item with a number no cited claim holds is dropped.

`--vertical "<who>" --sells "<what>"` fills five angles (pains, benchmarks, how they win clients, buying calendar, competitors) and two drafts (5 offers, 3 emails). `--redo claims --llm <stronger>` redoes the thinking from pages already read.

Recruiting, same 26 pages:

| Model and gate | Claims kept | Dropped |
|---|---|---|
| Cohere, first gate | 5 | 20 |
| Opus via Claude Code, fixed gate | 34 | 3 |

Both the model and the gate changed between runs, so not all of the gain is the model. Cohere is a first pass. Opus is the default for anything we act on.

## Dossier

One shape over every table the runners write. A fact is what, value, how sure, the page, how we know, when we last saw it.

- Company: findings, the newest enrichment per kind and model (call trail stripped), the hiring check, the firm's own inboxes.
- Person: findings, the profile lookup, each address with its newest verdict.
- Email facts live in channel-email (`emailFacts`). Research cannot import a channel, so the app merges them with `withFacts`.
- `show` takes an id, a domain or a name fragment. `export` writes JSON lines, 200 firms a page.

Read only. A dossier is as full as the runners made it. Locally that is the PPP firmographics and Cohere openers; no findings yet.

## Video variants

Each firm gets the portal demo with its own name in it, on its own page.

- **Brief** (`@wren/reactivation` `videoBrief`). From the dossier: the firm's display name. Skipped when there is no name, no words in it, or over 40 characters.
- **Walk** (`renderWalk`, `WALK` reactivation-demo v1). Playwright walks demo.wrenautomation.com. The portal's API answers are rewritten in the browser so the sample's name reads as the firm's; the demo database is never touched. Title card, home, the run, one brief zoomed on why to call now, the emails, why a line was written, end card. Captions are the portal's own copy. 36 seconds.
- **Record and encode** (`@wren/video`, no product knowledge). CDP screencast at 2x, real mouse and cursor. ffmpeg does 30 fps, zooms and captions after, so the page never moves. Poster at 5 s: the home screen with their name.
- **Publish** (`@wren/video/publish`). `v/<id>.mp4`, `.jpg`, then `.json` last, to a private S3 bucket behind CloudFront (`deploy/terraform/videos.tf`). The id is 16 random bytes. Cached a year; an id never changes.
- **Store** (enrichment kind `video`, model and prompt version from `WALK`). `recruiting_facts.video_url` is the newest render's watch link.
- **Watch page** (lander `/v/<id>`). Fills the firm, video and poster from the CDN's JSON. Offer copy from `offers.json`, button to the booking link. Noindex. `?r=` attribution through `hit.ts`. Bad ids 404.
- **CLI.** `wren video try <firm>` writes a local mp4, stores nothing. `wren video render <company> | --niche <n> --limit <k>` renders, publishes and records, one row per firm; a re-run skips firms that have this walk version. `wren video show <company>`.

Cost: 59 s of laptop time and 5 MB per firm. 1,000 firms is about 16 hours and 5 GB (cents a month on S3; CloudFront's free tier covers 1 TB out).

## Placement

Research lives in wren (`@wren/research`). autobrowse stays the web layer.

A study needs the database (documents, runs, findings), the LLM core and the niches. autobrowse knows none of those, by design. A study is still a step any wren workflow can call, which is the "primitive" William wanted.

## autobrowse

Green light given (2026-10-01). Nothing in research needs autobrowse changes now; future asks go to the "autobrowse work" session. State at 2026-09-30 23:15:

- `main` at 84798fb, matches origin. 4 files dirty: `src/browser/human/index.ts`, `src/explore/server.ts`, `src/recorder/redact.ts`, `test/recorder.test.ts`.
- `runs-and-walks` (worktree `autobrowse-runs`) at b2e0eb3, one WIP commit ahead of main ("runs log and llm ledger"), 24 files dirty.
- Consolidating onto one branch belongs to the "autobrowse work" session, which owns both.

## Needs your call

1. **Batch render.** One sample is live. Rendering a niche is about a minute per firm on the laptop.
2. **The email link.** `video_url` is in `recruiting_facts`; no copy uses it yet. Copy is yours.

## Decision log

- **2026-09-30** Seasons hurt through slow replies and January slippage, not lost demand. Fix what is ours now (holiday sends); offer terms are William's.
- **2026-09-30** Holidays are a send setting, default `us,ca,year_end`. Skipped like weekends: window, ramp and follow-up spacing.
- **2026-09-30** Research lives in wren foundations, not autobrowse. autobrowse is the web; wren owns the data.
- **2026-09-30** Claude Code is a model provider in `@wren/llm`, not a new interface. Claude Code drives the loop through the `research` skill.
- **2026-09-30** Cohere is a first pass. It does not synthesize well enough to act on.
- **2026-09-30** A claim stands on a quote that is on the page. A number must be in the quote; a year may come from the page. A dropped claim is not a finding.
- **2026-09-30** Drafts cite claims. The prompt forbids invented clients, results and "owners tell us". The gate cannot catch a made-up sentence with no number, so a person reads drafts before use.
- **2026-09-30** A PDF read in the browser has the title "about:blank": treated as no title.
- **2026-09-30** A failed `claude -p` still prints JSON. The error now says why (limit, killed, exit code).
- **2026-09-30** Studies run per unit and resume on re-run, the same as every long loop. No scheduler: a CLI run.
- **2026-09-30** One dossier shape over all research tables. Read only; runners stay the writers.
- **2026-09-30** The dossier is a subpath import. The research root pulls Playwright, which the CLI bundle cannot hold.
- **2026-09-30** An enrichment fact is the newest per kind and model. Older prompts are history. The model call's envelope, raw reply and parse are the ledger's, not facts.
- **2026-09-30** Video variants: plan only. The dossier export is the seam.
- **2026-09-30** SOPs deleted at William's word. He will redo them.
- **2026-09-30** The offer is 20 booked meetings in 90 days (the live page). The registry said 30 days, from an older draft; fixed to 90. The opener email quotes it, so it now reads "90-day".
- **2026-09-30** Holidays don't count toward the 90 days; they push the end out. No skipping a month. A seasonal dip is accepted (William).
- **2026-10-01** Video renderer self-built: Playwright plus ffmpeg, free, ours to learn (William).
- **2026-10-01** autobrowse green light for anything research needs (William). Nothing needed now.
- **2026-10-01** No per-lead demo tenant. The name swap happens in the recording browser, so `wren_client_demo` is never written.
- **2026-10-01** Videos on S3 plus CloudFront, not R2. R2 needs a card on Cloudflare, which is William's call; AWS is already paid for.
- **2026-10-01** The watch page is the lander's, not a raw mp4 link: the firm's name, the offer and the booking button around the player, and attribution.
- **2026-10-01** `@wren/video` knows no leads or products. The walk lives in `@wren/reactivation`; a new product writes its own walk.
- **2026-10-01** A video is an enrichment. Walk name is the model, walk version the prompt version, so a new walk re-renders and old ones stay history.
- **2026-09-30** An out-of-office that names a return day within 60 days holds the next step until the sending day after. The latest date wins. Dates far off or with no away word near them are ignored.

## Where to attack

1. **Vendor sources pass the gate.** 18 of 34 recruiting claims came from vendors selling into the niche. The gate checks the quote, not who said it. The report should mark vendor pages.
2. **Region drift.** A UK roundtable passed in a US and Canada study. Nothing checks a claim's country.
3. **Strong model is laptop only.** `claude-code` needs the login; the box has none. A study on the box runs Cohere.
4. **Made-up sentences without numbers** pass. Only a person reading catches them.
5. **No manual page.** A paywalled report or a PDF we hold cannot be added to a study. Wanted: `study add-page`.
6. **Claude Code calls cost $0** in the cost ledger. Subscription limits are invisible until a call fails.
7. **Two runners do one job** (PoolScheduler, `crm run`). Unify them before adding another. Studies stay a CLI run.
8. **Dossier is as thin as the runners.** No findings locally. A dossier for a firm no runner touched is a name and a domain.
9. **Dossier on prod** needs the prod database URL (`prod.env` via `parseEnv`); the CLI defaults to local.
10. **Thin angles.** Recruiting has no claim on client churn, sales cycle or Canada. A narrower study fills them.
11. **Video renders need Chromium and ffmpeg** where the CLI runs: the laptop today, not a scheduled job. A batch holds it an hour per 60 firms.
12. **Old renders stay on S3.** A new walk version uploads new files; nothing deletes the old ones.
13. **The walk breaks when the portal changes.** It clicks by role and text. A renamed link fails the render for every firm (loudly, per firm).
