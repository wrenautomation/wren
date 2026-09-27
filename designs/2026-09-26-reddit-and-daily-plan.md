# Reddit, daily plan, many accounts

**Status:** built 2026-09-26 (scaffolding only; nothing started, nothing posted).
**Ask:** organic Reddit + LinkedIn from the main accounts, several posts a day, a daily
job, a GraphQL API, and many LinkedIn and Reddit accounts for cold outreach.

## What was built

| Commit | What |
|---|---|
| 5a10eae | `SiteClient.call(..., account?)` and `asAccount(sites, account)`: any adapter talks as any autobrowse login, unchanged. Over Restate it rides as `sites.call {account}`; over HTTP as `?account=`. |
| e7d170f | Reddit as a content platform: `@wren/channel-reddit` over autobrowse site `reddit` in Reddit's API shape (`/api/submit`, `/user/{name}/submitted`, `/api/info`, `/comments/{id}`, `/api/comment`). Title required. `extra.subreddit` required before approval (`wren content extra <id> subreddit=…`); link posts via `extra.url`; media posts refused for now. Migration 0012 widens the platform check. |
| 362c72a | Reddit goes **straight to its API**, not through autobrowse. `redditApi` mints an access token from a refresh token (cached per container, re-minted once on a 401) and calls oauth.reddit.com; `journaledSites` makes each call one Restate step. Content handlers now treat a platform 4xx (not 408/429) as final, so a refused post fails its draft instead of retrying forever (all channels). |
| b5546f9 | Slots: a platform may have several a day; approval takes the first **free** one, so a batch spreads. `ContentPlanner/default` sends tomorrow's plan (slots filled, drafts waiting, ideas undrafted) at 17:00 fleet time. `wren content plan` prints the same. |

Turn on: `WREN_CONTENT_CHANNELS=linkedin,reddit,youtube,instagram` plus the four
`WREN_REDDIT_*` keys in deploy/prod.env (all commented out today), `push-secrets.sh`,
then `wren content planner start`.

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

- **P-D5 Reddit API direct; autobrowse only for setup.** Reddit has a real API with
  refresh tokens, so posting needs no browser. wren owns the calls. autobrowse does the
  browser work once: the account, the API access request, the app, the OAuth consent.
  The catch: since 11 Nov 2025 (Responsible Builder Policy) new API apps need Reddit's
  manual approval, often days to weeks, and small projects get refused. Free tier is
  100 requests a minute, non-commercial; we would use a few calls a day. Posting through
  the browser instead would dodge that gate, so it is not built unless William says so.

## Owed

- Done 2026-09-27: account u/WrenAutomation on william@wrenautomation.com (autobrowse
  `reddit@wren`, SSM `AUTOBROWSE_CRED_REDDIT__WREN_*`). API access request filed via
  Reddit's help-center form; Support confirmed. Decision by email to william@ in ~2–4 weeks.
- On approval, autobrowse makes the web app, runs consent (permanent; identity submit read
  history edit), and stores the keys in SSM. Then the four `WREN_REDDIT_*` keys go into
  deploy/prod.env, never printed.
- The request says **own-profile posts**. Posting to the profile is
  `extra.subreddit=u_WrenAutomation`. Posting into other subreddits goes past what we
  told Reddit; that's William's call before the first one.
- The account comments and ages before it posts (William, by hand).
- William's content, then approvals.
- Deploy: the worker change is not deployed (Actions blocked; build-on-box).

## Where to attack

1. `nextSlot` holds a slot by exact instant. A draft moved with `--at` to 08:31 leaves
   08:30 free, so two posts can land a minute apart.
2. `planFor` counts `published` rows for tomorrow, but only future slots are checked.
   It reads right only when it runs before the day starts, which the 17:00 run does.
3. Reddit may refuse the API request. Then Reddit is dead until William picks the
   browser leg or drops the platform.
4. Reddit `resubmit: true` lets a URL be posted twice in one subreddit; a repost is a person's approval away.
