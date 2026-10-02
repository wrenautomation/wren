# Reach: cold outreach on Reddit and LinkedIn

**Status:** scaffolding built 2026-10-01/02. Nothing sends until an account is added,
activated, templates are written, and `WREN_REACH_LIVE=1`.
**Ask:** cold Reddit DMs and cold LinkedIn invites + messages, off the main Wren
accounts, with warmup, caps, and deterministic autobrowse workflows for login, find,
profile read, message.

This supersedes P-D4 in `2026-09-26-reddit-and-daily-plan.md` ("many-account cold
outreach: not built"). What changed: one alt per platform, not many; real caps; the
same person behind every account. Mass account creation stays out (D1).

## Shape

```
autobrowse (Mac desk worker)        wren (Restate + Postgres)
  reddit / linkedin sites  <----->  @wren/channel-reddit  redditOutreach(sites, {account})
  per-account caps (429)            @wren/channel-linkedin linkedinOutreach(sites, {account, startedOn})
  flows: login, signup-reddit                 |  OutreachChannel (@wren/core/outreach)
                                              v
                                    @wren/outreach
                                      reach_accounts / reach_contacts / reach_messages / reach_templates
                                      ReachSender/fleet  (tick: plan -> relationship -> sending -> send -> sent)
                                      ReachWatch/daily   (replies + health, 30 min)
                                      ReachDesk          (accounts, find, enrich, enroll, templates, threads)
                                    wren reach ...
```

- **`OutreachChannel`** is the contract: `find`, `enrich`, `relationship?`, `connect?`,
  `message`, `replies`, `health`. Reddit has no connect step. `fakeOutreachChannel` is
  the test double.
- **Accounts** are autobrowse credential keys (`reddit@alt`, `linkedin@…`). A row starts
  `warming`; `activate` lets it send. A suspended health read pauses it by itself.
- **Standing** (policy.ts) is what an account may do today. Reddit runs the warmup ladder
  on its last health read: lurk (day 0) → comment (day 3) → post (day 14, 50 karma) →
  reach (day 30, 150 karma; 3 messages a day, +1 a week, top 5). LinkedIn ramps invites
  from 5 a day by 5 a week to 20, 20 messages a day. Sends go 10:00–17:00 New York,
  weekdays. autobrowse's own per-account caps sit under all of this and answer 429.
- **Sequences** are code (`reddit-dm`: step 1, step 2 +5d; `linkedin-connect`: invite,
  step 1 a day after accept, step 2 +6d). **Copy is William's**: every step and the
  invite note is a template slot, empty until set, and `enroll` refuses while a step is
  empty. Fields: `{first_name|there}`, `{company}`, `{headline}`, `{found_in}`, `{sender}`.
- **The tick** is journaled step by step (plan, relationship, sending, sent/failed) so a
  crash never sends twice: intent (`sending`) is written before the platform call, a
  `sending` row older than ten minutes becomes `unknown` and is never resent. A 429 holds
  an hour, another 4xx ends the contact as `unreachable`. One send per account per tick,
  then `gapSeconds`.
- **Replies** pull every 30 minutes and land on the thread; "stop", "unsubscribe",
  "remove me" and the like opt the contact out and skip the rest of the sequence. A reply
  stops the sequence and flags the thread unread; `wren reach reply` queues a manual
  message from the same account.
- **Held niches** (`WREN_REACH_HELD_NICHES`, default `sec_ria`) are refused at find and
  enroll.

## Decisions

- **D1 One alt per platform, not a fleet.** Twenty-five Reddit accounts on one Mac and one
  IP are linked by device and get removed together, taking Wren's main accounts with
  them. One alt on a sender email is a protective layer; a fleet is ban evasion. LinkedIn
  allows one profile per person, and a duplicate gets both removed, so the LinkedIn
  channel runs on a real account William names, never a created one.
- **D2 Reddit DMs, not chat.** `/api/compose` (private messages) is the deterministic,
  shape-stable surface. Chat is a different product with no stable API.
- **D3 Warmup is enforced, not advised.** The ladder is read from the account's own age
  and karma on every health pass. A fresh account cannot message no matter what the
  policy says. Comments and posts in the warmup are William's by hand (or the content
  loop), not automated here.
- **D4 Windows are ours, caps are per account, gaps are per account.** A DM is read when
  the recipient opens the app; the sender's 3am activity is the tell.
- **D5 Templates in Postgres, sequences in code.** Timing and structure rarely change and
  belong under test; words change often and are William's.
- **D6 Journaled tick, not `runPass`.** `runPass` wraps a pass in one `ctx.run`;
  platform calls through `restateSites` are service calls, illegal inside it. So the
  tick takes a `Journal` and the loop hands it `ctx.run`.
- **D7 Manual messages go to anyone who has not said stop.** Sequence steps need the
  contact `enrolled` or `connected`; a reply from the keyboard needs only that the
  contact is not `opted_out`, `blocked` or `unreachable`.

## Turn on

1. `autobrowse site setup gmail consent --account <sender>` then the `signup-reddit`
   flow on that sender email (not william@). If captcha or phone blocks it, an
   `autobrowse needs` row waits for William.
2. `wren reach accounts add reddit reddit@alt`, `wren reach accounts health <id>`
   (sets the ladder), comment and age the account by hand, then
   `wren reach accounts activate <id>`.
3. `wren reach templates set <key> --file …` for every slot William wants used.
4. `wren reach find <accountId> r/<sub> <words>`, `wren reach contacts enrich <id>`,
   `wren reach enroll reddit-dm --limit 5`.
5. `WREN_REACH_LIVE=1` in deploy/prod.env, `wren reach queue start`,
   `wren reach watch start`.
6. LinkedIn: William names the account; `wren reach accounts add linkedin linkedin@<label>`.

## Owed

- ~~The Reddit alt itself~~: made 2026-10-02 as `reddit@alt` (u/Ok_Crow5098, on
  will@wren-automation.com, email verified, Reddit picked the handle). Credential and
  the inbox consent are local to the Mac until `aws login` + `autobrowse creds push`.
  Added on prod (warming, lurk, health read ok). The prod CLI needs
  `WREN_RESTATE_INGRESS_URL` set to the cloud ingress on top of `scripts/prod-wren.mjs`.
- The LinkedIn account name.
- Copy for six slots.
- Deploy of the worker (migration 0049 applies on the next deploy).

## Where to attack

1. `sentToday` counts by `coalesce(sent_at, created_at)` on the fleet day; a row that
   went `unknown` counts against the cap forever that day (by design, conservative).
2. `reconcile` keys on `created_at`, not a `sending_at`. Safe while one keyed object
   runs the tick; wrong if a second sender ever shares the table.
3. `warmupOf` trusts `total_karma` from `/api/v1/me`; the browser leg must answer that
   shape or the account stays at lurk.
4. LinkedIn `relationship` is read once a day per pending invite; 20 pending invites is
   20 page reads a day on the Mac.
