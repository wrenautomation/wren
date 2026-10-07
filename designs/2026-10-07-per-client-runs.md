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

## Open (William's call)

- Spend: Meta launches for a client, the X API tier, Exa and model calls a client's runs make.
- App review: Google OAuth verification (YouTube, Calendar for non-Workspace), LinkedIn Community Management, TikTok audit, Meta app review.
- Whether a client's runs share Wren's read budgets (YouTube, Google) or get their own caps.
- Who approves a client's copy candidates and posts: Wren, the client's owner, or either.
- Whether a client's runs may use metered signal collectors and LinkedIn reads (off for now).

## Decision log

- 2026-10-07: Written. A part's group is what a client must bring. A part that can't run for a client yet says "In development" to a client and "Runs for Wren" to Wren's team.
- 2026-10-07: Social and signals ride the lead sheet's pool, so their `clientLoops` are empty: uninstalling them must not stop the pool. The pool reads each install on every pass.
- 2026-10-07: Buckets stay one per source: a client's room counts main's reads plus its own. Other clients' reads aren't counted; fine while clients run one at a time.
- 2026-10-07: B parts that ran as `for: "wren"` (comments, Reddit discovery, LinkedIn invites, social inbox) become `for: "client"` with `wrenSettings` kept, so a client sees them coming. `video.demo` becomes `for: "wren"`.
- 2026-10-07: Metered signal collectors and LinkedIn reads stay off for a client. They spend, and LinkedIn would read as an outreach account. Open above.
- 2026-10-07: `email.experiments` waits on templates live copy per client. `email.marketing` isn't built for Wren either. Both say "In development" to a client.
- 2026-10-07: `requires.anyAccount` for parts that run on whichever channel a client brings (posting, outreach). One connected is enough.
- 2026-10-07: Built: `ConsolePortal.connect` (the team's, `manage`, audited, refused while an installed part needs the account), the Shop's Accounts section with how-to and what waits, the "Needs your account" state, and `SearchWatch/<c>/daily` (Search Console into the client's database, at most 200 page inspections a pass). A client's "Coming" now reads "In development".
