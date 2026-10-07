# Per-client runs (2026-10-07)

## Answer first

- 27 Shop parts run only for Wren. 5 can run for a client on settings and the client's database alone (group A). 14 need the client's own account on a platform (group B). 8 stay Wren's by design (group C).
- Group A follows `2026-10-04-outbound-per-client.md`: the loop lists clients with the part installed, opens each one's database with `clientUrl`, reads its block, keeps data in `wren_client_<id>`. `{}` is a valid block.
- Group B gets the plumbing now: each part names the accounts it needs, the Shop shows how a client connects each one, and Wren's team sets the account from the Shop. A part whose per-client run is built says "Needs your account" until connected. One whose run isn't built says "In development".
- Nothing here registers an app, makes a platform account, asks for app review or spends. Those are William's, listed under Open.

## The parts

| Part | Runs for a client by | Group |
|---|---|---|
| `research.social` Social reads | The client's pool (`PoolScheduler/<c>/all`) reads YouTube and Instagram for its companies. Findings in its database. Read buckets count Wren's reads and the client's together. Settings: `youtube`, `instagram`. | A |
| `research.signals` Signals | The client's pool runs the collectors on its companies, with its own block. Buckets and Google's daily budget count Wren's reads too. Metered collectors and LinkedIn reads stay off for a client. | A |
| `research.dossier` Company dossier | The client's Pipeline firm page shows the dossier from its database: facts, people, sources. Read only; spends nothing. | A |
| `email.experiments` Copy experiments | `Evolution/<c>/fleet` ticks the client's experiments; candidates wait on Wren's approve. Waits on templates live copy per client (in flight). | A |
| `email.marketing` Opt-in marketing | The client's topics, signups and preference center, sent from its own mailbox with its postal address. Not built for Wren either. | A |
| `search.watch` Search watch | `SearchWatch/<c>/daily` reads the client's Search Console property into its database. The client adds Wren's service account as a user on the property. | B |
| `ads.meta` Meta ads | The client adds Wren's business as a partner on its ad account (`accounts.meta` = the ad account id). | B |
| `calendar.booking` Booking calendar | The client's Workspace admin lets Wren's service account use the calendar scope (`accounts.google_calendar`). A booking page on the client's site. | B |
| `content.posting` Posting | Any one channel account: `youtube`, `linkedin_page`, `x`, `tiktok`, `instagram`, `reddit`. | B |
| `content.planner` Content plan | Rides posting. | B |
| `content.social` Social inbox | Rides posting's accounts. | B |
| `marketing.stats` Marketing numbers | Reads what posting, ads and search write for the client. | B |
| `reach.outreach` Social outreach | Any one of the client's warmed accounts as autobrowse logins (`linkedin`, `x`, `reddit`). | B |
| `reach.touch` DM step | Rides outreach. | B |
| `linkedin.invites` LinkedIn invites | The client's LinkedIn login (`accounts.linkedin`). | B |
| `comments.read` Comment reader | The client's Reddit logins (`accounts.reddit`). | B |
| `comments.sort` Comment sort | Rides the reader. | B |
| `reddit.discovery` Reddit discovery | The client's Reddit logins (`accounts.reddit`). | B |
| `email.inbox_health` Inbox health | Each sending domain verified in Postmaster by a DNS record (`accounts.postmaster` = the domains). | B |
| `video.demo` Demo videos | A demo is a walk written in code for one product. Clients are data, not code. | C |
| `offers` Offers | Wren's own offers and lander pages. | C |
| `books`, `books.bills` | Wren's own money. | C |
| `watch.read`, `watch.triage`, `watch.score` | William's own mail and SOPs. | C |
| `studio` Video editor | William's recordings, on his Mac. | C |

Planned parts (speed to lead, voice, nurture and the rest) are not in this table: they aren't built for anyone and already say "In development".

## How a client connects (group B)

| Account | Stored as | How the client connects | Waits on William |
|---|---|---|---|
| `search_console` | the property, `sc-domain:example.com` | adds Wren's service account as a user on the property | no |
| `meta` | the ad account id, `act_123` | adds Wren's business as a partner on the ad account | spend on launches; the app's ads access level |
| `google_calendar` | the calendar's address | their Workspace admin allows Wren's service account on the calendar scope | only for a client without Workspace (OAuth app verification) |
| `youtube` | the channel id | OAuth through Wren's Google app | the app's verification |
| `linkedin_page` | the company page id | OAuth through Wren's LinkedIn app | LinkedIn's app review |
| `x` | the handle | posts through Wren's X app (OAuth); DMs through an autobrowse login the client hands Wren | the paid API tier, for posts only |
| `tiktok` | the handle | OAuth through Wren's TikTok app | TikTok's app audit |
| `instagram` | the account id | through the Meta business partner link | Meta's app review |
| `reddit` | autobrowse login names | hands Wren a login; Wren's team adds it to autobrowse | no |
| `linkedin` | autobrowse login name | as today | no |
| `postmaster` | the sending domains | adds the TXT record Postmaster gives | no |

## Build

1. A: social and signals on the client's pool, the dossier on the client's firm page, each with a test on synthetic data.
2. B plumbing: account sites and how-to text in core, `ConsolePortal.connect` (team, `manage`), the Shop's Accounts section and its states.
3. B run: `SearchWatch/<c>/daily`, the one per-client loop that needs nothing new from anyone.
4. `missing` on every part says the truth; C parts are `for: "wren"`.
5. Live flag per client: `clients.sends` lists the parts whose sends are on. `wren clients set <id> --live <part>` (`--live-off`), an admin's, audited. ANDed with the global gate. Read-only on the client record and the part page ("Sends off. An admin turns them on.").
6. Reads on the client's own gate: `meteredSites` and `meteredModel` (`@wren/core/metered`) gate and meter every read (Reddit, Exa, LinkedIn profile reads, models) on the client's vendor modes.
7. B runs on the client's Reddit logins: `ReachWatch/<c>/daily` (comment reader), comment sort in the client's database, `RedditReads/<c>/daily` (discovery). Data in the client's database.
8. Inbox health per client: `PostmasterScheduler/<c>/daily` on its verified sending domains into its database. Placement seeds and the digest stay Wren's.
9. Content and DMs per client on its LinkedIn and Reddit logins: `ContentPlanner/<c>/daily` drafts as the client through `ContentDesk/<c>/desk` into its To approve; `ContentScheduler/<c>/posts` and `ContentMetrics/<c>/posts` post and measure; `SocialWatch/<c>/social` reads comments, activity, followers. `ReachSender/<c>/fleet` and the `reach.touch` step run in its database. Posts and DMs hold until an admin turns its sends on. YouTube, X, TikTok, Instagram and a LinkedIn Page say "In development".
10. LinkedIn invites per client: `ReachWatch/<c>/daily` sweeps and queues on the client's LinkedIn login, `ReachSender/<c>/fleet` invites. Both wait on `--live linkedin.invites` and an active login (`wren reach accounts activate <id> --client <c>`).
11. Marketing numbers per client: `MarketingConsole` (`/api/marketing`) serves its drafts, posts, ad days and search from its own database once `marketing.stats` is installed. Approve, reject and redraft go to `ContentDesk/<c>/desk`, only from its approver. The portal's Marketing app shows these pages in the client's workspace. Its ads say "In development".

## Open (William's call)

- Spend: Meta launches for a client, the X API tier, Exa and model calls a client's runs make.
- App review: Google OAuth verification (YouTube, Calendar for non-Workspace), LinkedIn Community Management, TikTok audit, Meta app review.

## Decision log

- 2026-10-07: Written. A part's group is what a client must bring. A part that can't run for a client yet says "In development" to a client and "Runs for Wren" to Wren's team.
- 2026-10-07: Social and signals ride the lead sheet's pool, so their `clientLoops` are empty: uninstalling them must not stop the pool. The pool reads each install on every pass.
- 2026-10-07: Buckets stay one per source: a client's room counts main's reads plus its own. Other clients' reads aren't counted; fine while clients run one at a time.
- 2026-10-07: B parts that ran as `for: "wren"` (comments, Reddit discovery, LinkedIn invites, social inbox) become `for: "client"` with `wrenSettings` kept, so a client sees them coming. `video.demo` becomes `for: "wren"`.
- 2026-10-07: Metered signal collectors and LinkedIn reads stay off for a client. They spend, and LinkedIn would read as an outreach account. Open above.
- 2026-10-07: `email.experiments` waits on templates live copy per client. `email.marketing` isn't built for Wren either. Both say "In development" to a client.
- 2026-10-07: `requires.anyAccount` for parts that run on whichever channel a client brings (posting, outreach). One connected is enough.
- 2026-10-07: Built: `ConsolePortal.connect` (the team's, `manage`, audited, refused while an installed part needs the account), the Shop's Accounts section with how-to and what waits, the "Needs your account" state, and `SearchWatch/<c>/daily` (Search Console into the client's database, at most 200 page inspections a pass). A client's "Coming" now reads "In development".
- 2026-10-07 (William): just run it. Wren's team approves copy and posts by default (approver per client). Clients get their own read limits. LinkedIn reads and paid collectors may run for a client through the vendor gate. The texting cutoff is the legal limit.
- 2026-10-07: One live flag per sending part per client (`clients.sends`), off by default, set only by an admin from the CLI, ANDed with the global env gate. No toggle in the UI.
- 2026-10-07: A client's login is never one of Wren's: Wren's reach rows name them, and a client pass skips those. Logins sync into the client's own `reach_accounts`, starting `warming`.
- 2026-10-07: A client's reads go one at a time through `meteredSites`: gate, call, meter, each journaled. A gate saying no ends the pass's reads (`stopped`); the next pass asks again. The model is gated once a pass: a call costs no units, so only a mode or a cap changes the answer.
- 2026-10-07: `comments.read` no longer needs `reach.outreach`: reading comments sends nothing. A loop two parts share (`ReachWatch`) stops with the last of them.
- 2026-10-07: Discovery for a client needs its own About. Wren's default never reads for a client. Drafts use a plain voice until a client's voice is a setting.
- 2026-10-07: Inbox health per client reads a domain only once its setup holds `postmaster.verified` on that domain (not any domain the client owns). Wren's Postmaster login reads it, so the domain is added to it. Placement seeds send mail and stay Wren's.
- 2026-10-07: Content per client rides `WREN_CONTENT_CHANNELS` as its global gate: a client posts only on channels the worker runs. `Content.publish` and `reply` refuse a client's call while its `content.posting` flag is off; the scheduler holds its due drafts (`held`) and claims nothing.
- 2026-10-07: A client's drafts need its About (`content.planner` settings). They speak as the client, in a plain voice until it sets one, on its own `models` gate, and only for platforms its logins post on. Its ideas are its own and its readers' questions, never Wren's build log.
- 2026-10-07: Parts list the channels they will take as `soon`; the part page shows them under "In development". `reach.outreach` drops X from `anyAccount` until X DMs run per client.
- 2026-10-07: A client's LinkedIn invites need two admin acts: its live flag and its login activated (rows start `warming`, as Wren's do). `ReachDesk.accounts` and `setAccountState` take `client`; the CLI's `reach accounts list|activate|pause|retire --client`. An empty `account` setting means its first LinkedIn login.
- 2026-10-07: A client's Marketing is its own service, not the console's: the console serves Wren. Its pages are drafts, posts, ads, search and keywords; the rest (texts, site, sessions, inbox) are Wren's. One address `/marketing`, two apps: the workspace picks. A verdict is refused on the server to anyone the client's approver isn't. A redraft runs on the client's `models` gate.
