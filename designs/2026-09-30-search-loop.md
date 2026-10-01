# Search loop: keywords that tune themselves

Living doc. How wren watches wrenautomation.com in Google and AI answers, and how a person turns that into small copy
edits each week.
The site side (structured data, llms.txt, IndexNow, one host) is in `lander/designs/2026-09-30-search.md`.

## What it does

Daily, `SearchWatch/default`:

1. Pulls Search Console for the last 7 days (query × page × day), upserted. Google reports 2 to 3 days late and
   revises, so the window is re-read every day.
2. Inspects every sitemap URL. A page that leaves the index, or never gets in, is one notice.

Weekly, the first pass of a Monday sends `SearchWeek.run` once. It is its own service because it waits on the
Mac's desk, and the daily read must never wait on that:

3. **Fans out** each target keyword into the sub-questions an AI answer engine asks behind it (Google AI Mode and
   ChatGPT split a question into many searches and cite whoever answers the pieces). An LLM writes them; Google's
   "People also ask" adds real ones.
4. **Discovers**: a query with impressions that no keyword covers becomes a keyword (`source = query`).
5. **Asks the engines**: up to 20 keywords per engine, least recently asked first, go to Google (AI Overview +
   organic results + "People also ask") and Perplexity through autobrowse on the Mac's desk. Stored: did an answer
   cite wrenautomation.com, and at what rank. Three failures in a row stop that engine for the week.
6. Notifies: counts, then "brief ready, run `/search-week`".

The copy step is a Claude Code skill run by hand, `/search-week` (`.claude/skills/search-week/SKILL.md`):

1. `wren search brief` against prod (`node scripts/prod-wren.mjs search brief`): each keyword's impressions,
   clicks, position and engine citations; each page's index state and traffic.
2. Reads the lander source for those pages (`lander/src/content/`).
3. Drafts up to 6 small word or phrase swaps, each quoting the current text word for word, with a reason.
4. `wren search propose <file> --dry` gates them against the live site: the quote must be there; no price, no
   dash, no number the site doesn't state; at most 6 words changed (`MAX_WORDS_CHANGED`); no new FAQ or page.
5. Shows William each edit with its reason, plus notes for anything bigger. Nothing is stored or pushed before his yes.
6. `wren search propose <file>` stores them (last week's open ones go stale), then `wren search pr` opens the PR.

`wren search pr` turns open proposals into a lander pull request: each one whose quoted text appears once in
`lander/src/content/` is applied; the rest are listed in the PR body to do by hand. It works in a git worktree off
`origin/main` (the checkout is untouched) and runs the lander's `npm run check` before pushing. William merges; the
merge deploys; IndexNow tells Bing; next week's numbers show whether it worked.

## Commands

`wren search sync | keywords [add|retire] | discover | fanout | answers | brief | propose <file> [--dry] | proposals | drop | pr`,
and `wren search watch start|stop|status|sync|week`. Everything the loop does can be run by hand. Against prod:
`node scripts/prod-wren.mjs <args>` (reads `deploy/prod.env`, prints nothing from it).

## Tables (`packages/channel-search/src/schema.ts`)

| Table | One row per |
|---|---|
| `search_days` | day × query × page: clicks, impressions, position |
| `search_pages` | URL × day inspected: verdict, coverage, last crawl, Google's canonical |
| `search_keywords` | phrase we want to be found for; `source` seed / fanout / query; `parent_id` for fan-out |
| `search_answers` | engine × keyword × day: cited, rank, the cited URLs |
| `search_proposals` | one proposed edit: page, kind, current, proposed, why, status; `llm` set only on rows from before the skill |

## Decisions

| # | Decision | Why |
|---|---|---|
| Q1 | A foundation channel (`@wren/channel-search`), not a product | Any site wren runs can be watched; nothing here knows Wren's copy except through settings. |
| Q2 | Search Console as the `wren-sender` service account (site owner), no delegation | The key is already on Lambda; the scope is read-only (`webmasters.readonly`). |
| Q3 | Google auth imported from `@wren/channel-email` | It already signs the JWT; moving it down to core is a refactor for a later day. |
| Q4 | Poll daily; no webhook | Search Console has none, and its data is 2 to 3 days late anyway. |
| Q5 | Engine checks on the desk, weekly | Google bot-checks the box's IP. Weekly keeps the free Perplexity plan and Google's pace far from any limit. A missing Mac is a skipped week, not an error. |
| Q6 | Proposals, never auto-applied | A push to lander main is a deploy, and the copy is William's. Auto-apply is his call to turn on later. |
| Q7 | A proposal quotes current text verbatim; applied only on a single exact match | No fuzzy edits to his copy. A miss goes in the PR body for a person. |
| Q8 | Prices, invented numbers and client names never proposed | The page rules hold for every author: the gate (`refusal`, `propose.ts`) drops any edit with a currency amount, a dash or a number the site doesn't state; the skill says no client names. |
| Q9 | Only seeds and real queries fan out; "People also ask" under a fan-out question is not added | The list stays bounded: children never have children. |
| Q10 | The weekly run is a separate Restate service (`SearchWeek`), sent once per week | It waits for the Mac; a sleeping Mac delays the week, never the daily Search Console read. |
| Q11 | 2026-09-30: copy edits by a skill run by hand (`/search-week`), not an LLM step in `SearchWeek` | William's call. Copy is his voice; he sees each edit with its reason before anything is pushed. `SearchWeek` keeps sync, discovery, fan-out and engine checks. No cron yet. |
| Q12 | Edits are word or phrase swaps only, capped in code at 6 words changed | No sentence, style or section rewrites, no new FAQs or pages. Bigger ideas are notes in the chat, not edits. The cap (`MAX_WORDS_CHANGED`, words removed plus added) holds whoever writes the edit. |
| Q13 | The skill carries its own copy rules for now | Wren's copy SOPs (cold-email framework, lander copy rules, offer rules) must merge into one source the skill and agents both load. Not done yet; until then the skill uses only its built-in rules. |

## Settings

`WREN_SEARCH_SITE` (`sc-domain:wrenautomation.com`), `WREN_SEARCH_ORIGIN` (`https://wrenautomation.com`). Unset =
no `SearchWatch`/`SearchWeek` bound. Seeds: `wren search keywords add "<phrase>" --page /path`.

## State (2026-09-30)

Built and run locally against the live property: sync reads Search Console and inspects all 5 sitemap pages.
`/` and `/privacy` indexed; `/recruiting/lead-reactivation`, `/agencies`, `/terms` "Crawled, currently not indexed"
after the manual indexing requests. Prod: settings set, 7 seeds, `SearchWatch/default` started; all 5 pages
indexed by 2026-10-01. The LLM propose step is gone from `SearchWeek`; `/search-week` is ready to run by hand. Next:
the merged copy SOP (Q13), then maybe a cron for the skill.
