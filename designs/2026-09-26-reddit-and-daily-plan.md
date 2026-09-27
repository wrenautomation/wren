# Reddit, daily plan, many accounts

**Status:** built 2026-09-26 (scaffolding only; nothing started, nothing posted).
**Ask:** organic Reddit + LinkedIn from the main accounts, several posts a day, a daily
job, a GraphQL API, and many LinkedIn and Reddit accounts for cold outreach.

## What was built

| Commit | What |
|---|---|
| 5a10eae | `SiteClient.call(..., account?)` and `asAccount(sites, account)`: any adapter talks as any autobrowse login, unchanged. Over Restate it rides as `sites.call {account}`; over HTTP as `?account=`. |
| e7d170f | Reddit as a content platform: `@wren/channel-reddit` over autobrowse site `reddit` in Reddit's API shape (`/api/submit`, `/user/{name}/submitted`, `/api/info`, `/comments/{id}`, `/api/comment`). Title required. `extra.subreddit` required before approval (`wren content extra <id> subreddit=…`); link posts via `extra.url`; media posts refused for now. Migration 0012 widens the platform check. |
| b5546f9 | Slots: a platform may have several a day; approval takes the first **free** one, so a batch spreads. `ContentPlanner/default` sends tomorrow's plan (slots filled, drafts waiting, ideas undrafted) at 17:00 fleet time. `wren content plan` prints the same. |

Turn on: `WREN_CONTENT_CHANNELS=linkedin,reddit`, then `wren content planner start`.

## Decisions (reasoning pass)

- **P-D1 One post a day, not several.** LinkedIn splits reach across same-day posts.
  On Reddit several posts a day from one account reads as spam: subreddits ban it and
  new accounts get rate-limited. The machinery allows more slots; the defaults keep one
  (weekdays). Reddit's growth comes from comments in threads, not post volume, so
  `reply` is wired too.
- **P-D2 No GraphQL.** You're the only operator, and the clients are the CLI and Claude.
  Restate handlers already give HTTP. GraphQL would add a server, a schema layer, auth
  and a deploy for no new capability. New surfaces are `wren content …` commands.
- **P-D3 Daily planner reports, never acts.** Drafting costs money and approving is
  publishing. Both stay William's.
- **P-D4 Many-account cold outreach: not built.** Buying or farming LinkedIn and Reddit
  accounts to DM strangers breaks both platforms' rules (one real person per account on
  LinkedIn; spam and ban evasion on Reddit). Detection links accounts by device and IP,
  so the shared autobrowse box puts Wren's main accounts in the same ban. It also
  presents fake people to prospects. Cold email already works for the same leads.
  The sound version, if wanted:
  - LinkedIn: William's own account, a handful of connection requests a day, each
    approved by him, drawn from leads already in Postgres.
  - Reddit: no cold DMs. Inbound comes from organic posts and replies.
  `asAccount` covers the several real accounts we already have (personal vs Wren).

## Owed

- autobrowse `reddit` site (OAuth app "script" or web leg) — the adapter has nothing to call yet.
- A Reddit account for Wren (`reddit@wren`), aged and commenting before it posts.
- William's content, then approvals.

## Where to attack

1. `nextSlot` holds a slot by exact instant. A draft moved with `--at` to 08:31 leaves
   08:30 free, so two posts can land a minute apart.
2. `planFor` counts `published` rows for tomorrow, but only future slots are checked.
   It reads right only when it runs before the day starts, which the 17:00 run does.
3. Reddit `resubmit: true` lets a URL be posted twice in one subreddit; a repost is a person's approval away.
