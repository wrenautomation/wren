# Portal places: a product shell

2026-11-04. Status: layout agreed (William, 11-04). The picks under "Open picks" wait on him.
Builds on `2026-11-02-campaigns.md` (a campaign is a group on the metro map),
`2026-11-02-starling.md` (the marketing product), `2026-10-06-scoped-access.md` (grants) and the
WA-1043 pause (40 loops stopped 11-03). An adversarial pass (Sonnet, 11-04) checked this doc
against the code. Its findings are folded in.

## Why

William, 11-04: "it's really important that we get this grouping right, so conceptually it
doesn't create any mental overhead ... so we don't end up with this current version of Wren where
there's a bunch of stuff and not a lot of stuff is being used."

Today Wren's team has 5 fixed items, 3 areas and about 35 apps. In 35 days William wrote through the
portal about 6 times. His console calls in the last 14 days: approve invites 60, list pieces 33,
content waiting 22, mark read 17, the rest under 10. The agent and the loops do the work through
the CLI. So the portal is where a person sees, approves and annotates.

## Product shell (supersedes the six places, 11-04 night)

William, 11-04: "we as a business we create the system for other businesses ... so essentially
were making a giant product line, and the catalog of products ... each thing should be able to
function as its own product, or dependencies are minimal ... crm is honestly just a small part of
it". The unit of the portal is a product a client buys, not a CRM object.

Options (William picked D):

| | Shape | Against it |
|---|---|---|
| A | Sidebar by product, locked ones grey | The sidebar grows with the catalog; shared data repeats |
| B | Agent first, no sidebar: a feed and the chat | Deep work (the content plan) has no home |
| C | Places by object (the six places above) | One product spreads over 3 places; a client can't see what it bought |
| D | Fixed shell + product apps on one small core | Core vs product must be drawn right, or overlap comes back |

Ranked: matches how we sell (product = unit of sale and access), few places, products depend on
core only, agent-native.

Shape:
- Fixed: **Today** (to approve, messages, calendar; a client's adds Needs you), **Results** (one
  board of tiles over every product). Ask is the chat panel on every page, not a place.
- Products: each one place built with `product()` (`modules/product.ts`). At most 4 tabs, in slot
  order: overview, work (needs you or make), results, settings. More pages only as hidden detail
  pages reached by link. The type holds the cap, so no micro sections.
- Core: Map (team home: the metro map and offers), Clients (team), People (one list), Back office
  (contracts, money, accounts, team).
- A product imports core only, never another product. A client sees a product's pages by its
  component (entitlement); Wren is client zero with all of them.

Team sidebar: Map, Today, Results · Content, Outbound, Research · Clients, People, Back office.
Client sidebar: Today, Results · Project, Content, Reactivation · People, Back office.

Catalog: core offer Audit + direction, then Content funnel. Add-ons: Outbound, Paid ads (later),
Lead tracking + analytics, Research, SOPs, Automations, Newsletter, Community (far future). A
product gets a module only when one sells; today Content, Outbound and Research run, and Audit
and Reactivation are sold.

Backends: site analytics stays (sessions, heatmaps, surveys, experiments), no UI, for Lead
tracking. Client SMS products (speed to lead, missed calls, review asks, reminders) go; SMS stays
for newsletters. Ads and RedditReads go. Git tag `pre-cut-2026-11-04` marks the code before the cut.

## Ground-up cut (superseded by the product shell)

William, 11-04: "we need to be even more aggressive with pruning and only keep essentials (and
things we know for a fact we'll need like contracts) ... hyperaggressive so we can tune this from
the beginning from the ground up". He picked option C: delete the UI and the idle backends.

Keep rule: a page or package stays only if it runs today (content, engage, infra loops) or is a
known need (contracts, money, client access). All else goes. Git keeps the code; the lake keeps
the data.

Team portal, 6 places, the chat panel on every page:

| Place | Pages |
|---|---|
| Inbox | Messages (every channel, one list), Approve (drafts and invites that wait for a yes) |
| Content | Plan (posts by date), Drafts, Posted (with metrics) |
| People | Contacts (one list; the person page shows touches and bookings), Deals (one list with a stage) |
| Clients | Clients (the client page: contract, invoices, deliverables) |
| Research | Birdwatch |
| Back office | Contracts (documents, e-sign), Money (invoices in, spend), Accounts (channel connections, email inboxes), Team and access |

Client portal: Home (updates, needs-you, deliverables), Content (approve, posted), Messages,
Account (invoices, contract).

Calendar is not a place: posts show in Content › Plan, bookings on the person.

Backends:

| Goes | Stays |
|---|---|
| SMS: the channel, SmsSend, SmsUpkeep, client SMS products | Reach and engage: LinkedIn invites, comments, DMs (the judge reads them) |
| Ads: Meta ads, AdSpendGuard, ad pages | Meta posting for content |
| Site analytics: visits, sessions, heatmaps, surveys, experiments rollups, SearchWatch | Lander forms into People (bookings, applications) |
| Cold email sending: EmailSend, EmailOpenerFill, LeadPoolFill, EmailClickPull, opens, sequences, enrolment, reports | Email deliverability (William: keep "the email domain warmup deliverability code"): inboxes and roster, domains, Instantly warm-up, ramp, EmailPlacementTest, EmailPostmasterPull, EmailBounceRead, spam score, sender pause, EmailFleetDigest, SetupRecheck |
| RedditReads | Autobrowse Reddit flows |
| Map (offers, terms, numbers, reports, playbook pages), Campaigns place, pipeline board, journeys pages | `@wren/offers` registry (lander export), Learn's SOP half, the executor (CLI) |

Open: `@wren/reactivation` is the sold offer's engine and sends through cold email. It stays until
William picks (see Decision log).

Steps, each one commit that builds, tables to the lake before a drop:
1. UI: the six places for team and client; every other page and module deleted.
2. SMS. 3. Ads. 4. Site analytics. 5. RedditReads. 6. Cold email sending (deliverability stays).

## Target (superseded by the ground-up cut)

The sidebar:

| Place | Holds | One-line test |
|---|---|---|
| **Map** | The business: offers and terms, the shape (metro map), business numbers and reports, the playbook (SOPs, brand, voice, templates) | What we sell, how it flows, what it earns, how we do it |
| **Campaigns** | Each campaign: offer, audience, CTA ladder, channels (cold email, engage acts, ads, SMS), landers and forms, budget, results, experiments | One push of one offer to one audience |
| **Content** | Every piece and its life: plan and cadence, ideas, drafts, posts, recordings, topics, facts, media, digest. Studio is the piece page | Something we made to publish |
| **People** | The CRM: every person and company, timeline, traits, stage (lead, client), journeys board, calls, form answers, followers and subscribers | Someone we know |
| **Inbox** | What waits on a person: today, mail, replies, DMs, comments and reviews to answer, approvals, holds, mentions, access asks | It needs you now |
| **Calendar** | Every dated thing: calls, scheduled posts, campaign dates, sends | When |
| **Research** | Birdwatch: runs, studies, sources, competitors | What we learned outside |
| **Back office** | Money, contracts and documents, team and access, payroll later, channel setup (inboxes, domains, accounts), products, settings, a system health line | Runs the company |

Two shared parts sit over every place:
- **Chat panel.** The existing `AgentPanel` (`modules/agent/panel.tsx`, over `wren agent serve`)
  becomes a side panel on every page. It knows the page and the selection. It answers questions,
  starts Birdwatch sessions and brainstorms. Results land in Research or on the object. It takes
  over the Ask app and Research's Ask page. The `agent` CLI and the clients' agent setups stay.
- **Campaign filter.** In the top bar. It scopes People, Content, Inbox and Calendar to one campaign.
  The default campaign (computed, `campaignsOf`) means "all". Money joins with direct costs
  per campaign.

## Rules

1. **One home per object.** An object's data is edited in its place only. Inbox and Calendar run
   actions on rows (approve, release, reply, take, snooze), and each row opens its home for edits.
2. **A product is an entitlement, not a tab.** A product is a set of components
   (`clients.products`, `installs.ts` `has`; prod keys today: `delivery.portal`,
   `delivery.invoices`, `delivery.contract`, `delivery.reviews`, `content.posting`,
   `content.social`, `marketing.stats`, `reactivation`). Each component switches on sections inside
   the eight places. A new product adds no tab.
3. **A locked section teases.** A client without a product sees its section in place, read only,
   with what it does and an ask to add it. Back office › Products lists every product, read only.
   The Marketplace app and the Shop's self-install leave the portal. Installs become an operator act
   (CLI) until the redesign.
4. **Dev tools stay off the portal.** Workflows, loops, feature flags, infra and handlers live in
   the CLI. The portal keeps a health line in Back office and the holds in Inbox.
5. **The agent's work shows where it lands.** A loop's output shows on its object (a draft in
   Content, a send in a campaign, a reply in Inbox), never on a loop page.

## Where every page goes

Team workspace, by app id and page:

| App | Page(s) | Goes to |
|---|---|---|
| map | all | Map |
| offers | offers, terms | Map › Offers |
| numbers | shape, offers, economics, months, channels, cohorts | Map › Numbers. Per-campaign numbers also in Campaign › Results |
| library | templates, sequences, snippets, sections, SOPs | Map › Playbook |
| library | media | Content › Media |
| library | workflows | CLI, with Workflows |
| pipelines | board, journeys | People › Board |
| people | people, timeline, traits | People |
| people | data, addresses, merges | Parts of the person page |
| clients | clients, health, flags, days, inputs, usage | People (a client is stage `client`; health and flags are filters; days, inputs and usage on the client's page) |
| leads | lead sheet | Removed. People with stage `lead` |
| outbound | campaigns, signals, stalls | Campaign › Cold email |
| outbound | companies | People |
| outbound | inboxes | Back office › Channels |
| outbound | sheet | Removed (the lead sheet) |
| engage | engage, invites, threads and places, DM copy | Campaign › Engage. Reddit pages go with RedditReads |
| engage | DMs, people | Inbox (DMs) and People |
| engage | accounts | Back office › Channels |
| engage | auto-reply, comment keywords, keyword DMs | Campaign › Rules (global until the stamp exists, phase 4) |
| ads | ads, formats | Campaign › Ads (a stub until ads start) |
| sites | pages, funnel, funnel map, links, forms | Campaign › Landers |
| sites | submissions | The person |
| analytics | visits, sessions, funnel, links, conversation, metrics, reports | Campaign › Results |
| analytics | heatmaps, surveys, experiments | On the lander; experiments in Campaign › Results › Experiments |
| analytics | search days, search, keywords, AI answers | Removed (SEO later) |
| content | plan, cadence, pieces, write, drafts, posts, recordings, topics, facts, digest, metrics | Content. Studio is the piece page |
| content | feed, explore | Campaign › Engage (targets) |
| content | today | Inbox › Today |
| content | comments | Inbox |
| content | followers, subscribers | People |
| inbox | your mail, mail rules, mentions, email replies, to approve, done | Inbox |
| calendar | schedule, overview, calls | Calendar |
| calendar | recordings | Calendar and the person |
| money | overview, spend, model usage, payments in, subscriptions, card, in-house, accounts | Back office › Money |
| team | team, changes | Back office › Team |
| access | roles, grants, review, issues | Back office › Team › Access |
| settings | systems, guide | Back office › Settings |
| settings | layout, themes, look | Back office › Settings › Look (one page) |
| research | runs | Research |
| research | ask | Chat panel |
| ask | questions | Chat panel |
| learn | home, today, search, sources, saved, competitors | Removed as an app. Birdwatch covers it. See Removals |
| notes | notes, board | Removed as an app. See Removals |
| workflows | all, new, canvas, executions, events, checks | CLI |
| workflows | holds | Inbox |
| loops | agents, loops, infra | CLI; a health line in Back office |
| loops | settings, flags | CLI verbs first (phase 1), then removed |
| handlers | all, AI tools | Removed. AI tools stay in Back office › Settings (`account/AiTools`) |
| review | parked ideas | Removed. The task board does this job |
| marketplace | catalog, map, browser mods | Removed. Back office › Products, read only |

Client workspace:

| App | Page(s) | Goes to |
|---|---|---|
| work | plan, results | Map › Your plan (what Wren delivers and its results) |
| work | contract, paperwork | Back office › Documents |
| work | welcome | Inbox (first-run asks) |
| reactivation | all | A campaign: audience the client's old leads, channels email and SMS |
| texts | threads | Inbox; SMS is a campaign channel |
| calls | all | Calendar and the person |
| payments, documents (with templates) | all | Back office |
| account | its 16 pages | Back office › Settings |
| leads | all | People |
| marketing | reviews | Inbox (to answer) |
| marketing | search, keywords | Removed (SEO later) |
| marketing | reports | Map › Numbers › Reports |
| marketing, sites, calendar, settings (client copies) | rest | Same as the team's place |
| clientLearn, clientNotes | all | Removed with the team apps. The note and mention parts that stay (see Removals) stay for clients too |
| voice | all | Stays parked |

The client sidebar is the same eight places, less Research (team only until it is a product). A
place with no component the client holds shows as a teaser (rule 3). Today (`today.tsx`) becomes
Inbox › Today, and its add-on cards point to the teasers. The phone dock (`phoneTabsOf`, `dockOf`):
Inbox, Calendar, Content, People, plus pins.

## Experiments (A/B and variants)

William, 11-04: a first-class tester for ads, landers, outbound copy and copy in general, "using
statistics to make data-driven decisions".

Placement: a capability, not a place. An experiment belongs to a campaign (the default campaign
holds the always-on ones). Each variable thing can carry variants: a lander, a cold email step, an
ad, a post hook, title or thumbnail. Results show on the thing and in Campaign › Results ›
Experiments. Sold as its own product (rule 2).

What exists:
- `@wren/experiments`: a bandit with a pooled Beta prior, P(best), guards and convergence
  (`engine.ts`, `simulate.ts`). The unit is the recipient. Used by `starling-search` experiments and
  `sites/src/split-call.ts`.
- Site flag experiments (`experiment-store.ts`, `flag_experiments`): 0 rows on prod.
- Post variants (`post_variants`: title, thumbnail and hook swaps): 370 rows.
- Copy experiments: dropped (migration 0236).

Volume limit: most of our tests will not reach a result at today's traffic. The engine must say
"not enough data yet" and give the sample it needs. The test plan should favour big swings. A swap
on one post over time (title A, then B) is confounded by time and must say so.

The engine is a core substrate, so it gets its own design doc, starting from `@wren/experiments`.
It compares that engine with GrowthBook's `gbstats` and with GrowthBook self-hosted (needs MongoDB;
the box has no spare memory). Not built in this doc's phases.

## Options for the layout

Ranked priorities: one home per object, then fit with agent-does and human-approves, then a new
product adds no tab, then clients share the skeleton.

| | Shape | For | Against |
|---|---|---|---|
| **A. By object (chosen)** | Map, Campaigns, Content, People, Inbox, Calendar, Research, Back office | One home each. Products gate sections. Clients get the same tabs | A campaign page pulls from Content and People. The campaign filter covers it |
| B. By stage | Plan, Make, Ship, Talk, Learn | Follows the work order | One object split over tabs: a piece is in Make and in Ship |
| C. By product | Starling, Outbound, Reactivation, CRM… | Matches what we sell | Today's sprawl. Each product adds a tab; people show in each |
| D. Campaign hub | Everything inside a campaign | Strong campaign focus | Always-on work (inbox, evergreen content, research) has no home |

## Removals

Rule (William, 11-04): be aggressive. A part stays only if a place in this doc names it or a
running loop needs it. All else goes now and is rebuilt later. Nothing waits for its replacement.
Git keeps the code; the lake keeps the data. Phase 2 starts with a sweep by this rule; the list
goes to William once before the delete. Two guards:
- Data first: before a table drops, the last lake snapshot (`lake-sync.ts`, nightly) is later than
  the table's last write, client schemas included.
- One change cuts both ends: a delete removes every caller in the same commit, so the build passes
  and the running loops keep working. Running: ContentPlanner, ContentScheduler, TokenRenewal, and
  the infra six (LoopWatch, DeadLetters, AuditSealer, VaultKeys, TokenRenewal, PageArchive).

No client holds a product on prod (only `demo` and `wren_test`), so no paying client loses a part.

| Kind | What goes | What stays or moves |
|---|---|---|
| Learn | The reader half of `@wren/learn`: items, feeds, creators, alerts, digests, breakdowns, hunt, catalog, drive, pictures, score; its tables (573 items, 165 breakdowns, to the lake); the Learn app and client copy; `wren learn` and its readers | The SOP half (standards, checks, `sops.ts`, `film.ts`) moves to the Playbook, because ContentPlanner checks drafts against it. SOPs and their sources live in the `sops/` repo (`learn.sop_sources` has 0 rows) |
| Notes | All of it: the app and client copy, thread notes, @mentions and Inbox › Mentions, record backlinks, quick capture, `wren notes`, the tables (to the lake) | Nothing |
| Review | The Review app (parked ideas) | |
| Handlers | The Handlers app | `account/AiTools` |
| Marketplace | The app, the Shop UI and self-install, browser mods | Install code for the operator CLI |
| Workflows, Loops | The portal apps | CLI verbs. `wren features` (built in phase 1) is the only writer of feature flags: the kill switch and `POST_NOW` |
| Ask | The Ask app | `wren agent`; the chat panel |
| Leads | The lead sheet (team `leads`, outbound `sheet`) | People |
| SEO | The search pages (search days, search, keywords, AI answers), SearchWatch, `search-week` | The `starling-search` reads (Search Console, AI answers), as Reddit's adapter: SEO and Google Ads come back later as campaign channels |
| Client SMS products | Speed to lead, missed calls, review asks, booking reminders, form texts (`sms reminders`, `sms forms`), SmsWatch's client passes | The SMS adapter and cold SMS, for campaigns (reactivation) |
| Loops | RedditReads and its CLI verb; the stopped keys of retired niches (ComposeScheduler, PoolScheduler `agencies`, `sec_ria`) and of the 10 retired senders; `report weekly` | Autobrowse Reddit flows and the `starling-reddit` adapter. SetupWatch: Back office › Channels needs it |
| CLI | Each command of a removed part, found by a reader check | `video *` for now (a redesign later) |
| Skills | `portal` rewritten for the places; `wren` trimmed to what stays | `research`, `lander`, `wren-ui` |

Kept and reshaped:
- **Books becomes Money.** The ledger (AWS bill, card, payments) is the data behind Back office ›
  Money. Rename `@wren/books` to `@wren/money`, `wren books` to `wren money`, and the `Books`
  Restate service while it is stopped (no invocation in flight).
- **Cold email splits.** What only email has stays as the email channel, set up in Back office ›
  Channels: inboxes, domains, warm-up, placement, postmaster, bounces. The rest joins the shared
  outreach in Campaigns (phase 4): drafts and the review seat become Inbox › To approve, copy
  lives in the Playbook, sequences and enrolment are campaign steps.

Loops kept: the running set above. The other stopped loops restart with their place, or go with
their part.

## Phases

UI follows the design-language artifact (`designs/2026-10-20-design-language/`) and the `ui-design`
proof step.

1. **Places and moves.**
   - `areas.ts` becomes the eight places for team and client, with the client sidebar and the phone
     dock above.
   - Pages move to their place's app id. Old links go in `moved.ts`, and every href in code moves
     too (`moved-guard.mjs`). A client's old ids redirect through `CLIENT_MOVED`.
   - Grants and the route inventory move to the new ids (`core/src/access.ts` `APPS`). Prod
     `grants` is empty, so no data moves.
   - Holds show in Inbox.
   - The removed apps leave the nav.
   - Done when: the sidebar shows the places in both workspaces and on the phone; every old link
     lands (`moved.test.ts`); grants and the route inventory pass on the new ids.
2. **Deletes.** The Removals table, right after phase 1. Exact CLI paths after a reader check
   per command. Learn's SOP half moves to the Playbook in the same change.
   - Done when: no code, route, loop key or skill of a removed part is left; `knip` is clean.
3. **Map and Back office.** Map › Offers, Numbers (reports), Playbook. Back office ›
   Money, Documents, Team and Access, Channels, Products (read only), Settings, the health line.
4. **Campaigns place.** List and campaign page from the metro groups: overview, channels, landers,
   rules, budget, results. Cold email's drafts, review, copy and sequences join the shared outreach. The stamps it needs, each with its writer: a lander's campaign
   (`sites` pages), auto-reply and keyword-DM rules per campaign. The campaign filter.
   - Done when: a campaign's channels, landers, rules and results show on one page; the filter
     scopes People, Content, Inbox and Calendar.
5. **Content and Studio.** Studio is the piece page: player, micro edits, annotations (the `video`
   editor verbs behind it).
6. **People.** Clients, the board, companies, calls, recordings and form answers on the person.
7. **Inbox and Calendar.** Inbox › Today, approvals, holds, DMs, comments, reviews, mentions.
   Calendar shows every dated thing and opens its home.
8. **Out of scope.** The chat panel (WA-1066, another session) and the Research place's
   Birdwatch UI (tuned first, apart). This doc only places them.
9. **Products and teasers.** First the map of product → components → sections. Then each locked
   section teases, and Today's add-on cards point to them.

Experiments: its own design doc and phases, after phase 4.

## Open picks (William)

None.

## Decision log

- 2026-11-04: layout A, by object (William). Agreed moves: Offers and Numbers to Map; Pipelines,
  Clients and Leads to People; Money, Team and Admin to Back office; Engage, Outbound, Ads, Sites
  and Analytics to Campaigns ("main thing, it should be in the campaign"); Workflows and Loops off
  the portal; Ask to the chat panel; Research is Birdwatch; the Learn, Review, Handlers, Notes and
  lead sheet apps removed; Marketplace removed, a read-only teaser later.
- 2026-11-04: Calendar stays a place (William).
- 2026-11-04: products are entitlements over the same places, with in-place teasers for upsell
  (William: "they can just have limited access based on what they paid for").
- 2026-11-04: Experiments is a capability inside campaigns and its own product; its engine gets its
  own design doc, starting from `@wren/experiments`.
- 2026-11-04: loop and CLI cuts as listed. RedditReads goes; autobrowse Reddit flows stay
  (William: "deleting Reddit is fine as long as the autobrowse workflows stay").
- 2026-11-04, adversarial pass: removals narrowed to the apps. The Learn and Notes packages, the
  `email` review seat, the `video` editor, `books`, `sms reminders` and `sms forms`, and SetupWatch
  stay, because kept parts read them. Deletes wait for their replacements. Map, Inbox and Calendar
  got phases. Flags and loop settings get CLI verbs before the Loops app goes.
- 2026-11-04, William's picks:
  - Playbook is Map › Playbook. The sidebar stays at eight.
  - Grants scope by place plus channel. `APPS` becomes the place ids.
  - A client's reactivation run is a campaign: audience their old leads, channels email and SMS.
    This replaces Starling's rule that client SMS products are delivery work, for reactivation only.
  - Cost per campaign is direct costs only (texts, ads, paid data). Shared monthly costs stay in
    Back office totals.
- 2026-11-04, William on the adversarial pass: delete what is unused or badly designed now, never
  wait for a replacement. Learn: keep the SOPs and move them to the Playbook; the rest goes. Notes:
  all of it goes. Client SMS products go. `video` stays for now. Clients may not self-install.
- 2026-11-04, William: be more aggressive with removals. Books stays, renamed Money, inside Back
  office. Cold email keeps its inbox setup (domains, warm-up, deliverability); its review, copy and
  sequences join content and outreach. SEO is not a place and not now: its pages and loop go, its
  reads stay for SEO with Google Ads later. The chat panel and the Research UI are out of this
  doc's scope.
- 2026-11-04, phase 1 as built:
  - Home is the Map row (`NavHome.row`), not a separate link. Phone dock: Inbox, Calendar, Content,
    People, plus pins.
  - `CLIENT_MOVED` replaces `CLIENT_HELD`: a client's old addresses redirect like the team's.
  - `moved-guard.mjs` skips vendor paths, migrations and stored views. Stored views
    (`profiles-schema.ts`, the inbound schema) keep their old links; the redirects cover them.
  - `APPS` is the place ids plus the parked apps, `as const`, so `App` is a literal union and a stale
    id fails typecheck. A record's app is the place whose list page shows it. A route's app is
    where its page lives: drafts Content, replies Inbox, reports Map, mail access Back office.
    Prod held no grant, role, token or ask naming an app, so no data moved.
  - `delivery.portal` gates Map › Your plan. Prod has 0 `workflow_installs`, so no client loses a
    page to the gate.
  - `provides.apps` dropped from components: products gate pages, each page naming its component.
  - Flags: `wren features`, not `wren loops flag`. A flag is not a loop, and `wren flags` already
    holds client risk flags. Edits go through `editRecord` (History, Undo) and push the lander's edge.
  - The e2e scripts were moved to the new addresses without a run; CI does not run them.
  - Plan pages have one address for every offer: `planPath(page)` in `@wren/delivery` (Map, with
    needs-you, deliverables and welcome in Inbox, paperwork and contract in Back office). The
    per-app project filter is gone: Map lists every project. Before this, a client's plan sent
    `app: map` and matched no offer, so it showed empty; prod held 1 test engagement only.
  - Inbox replies check grants at `inbox` (was `marketing`, a string the type sweep missed).
- 2026-11-04, phase 2 picks (William, on the sweep). Prod runs 8 of 75 loops; ContentPlanner is
  the one that reads Learn.
  - Learn keeps SOPs and their sources: items, breakdowns, `standards`, checks, `sop_sources`, the
    film-to-SOP path. The reader half goes. To be redesigned into Birdwatch outputs or Map's brand
    voice.
  - Notes: only the Inbox's thread notes and @mentions stay, moved into the conversations package.
    Docs, the `wren tasks` board (Backlog.md took its job) and the SOP-to-note step go.
  - SearchWatch splits: the rollups (heatmaps, surveys, experiments, `site_days`) move to their own
    loop, left stopped until the experiments phase. The SEO half goes.
  - Stopped loops no place names (Decide, LineFeed, PainFeed, SourcedFeed, TouchFeed, PeopleMapNet,
    SegmentsNet) stay in this pass: traced, then listed to William.
- 2026-11-04 evening, William: the ground-up cut, option C (delete UI and idle backends), over
  A (hide) and B (UI only). Keep the email warm-up and deliverability code. Reach stays: the judge
  (designs/2026-11-04-loops.md) grades its comments.
- 2026-11-04 evening, William on the evidence pass (audit log, 35 days: 25 portal writes by a
  person): most pages go. Backends stay: outreach, content, cold email, reactivation, SMS (for
  newsletters), site analytics with heatmaps (UI off, wired in later). Calendar stays a place. The
  Deals page goes. RedditReads goes; the autobrowse Reddit code stays. Ads go (0 rows). He will
  rebuild the system from the ground up and reorganise outreach and content later. So the cut is
  the UI plus Ads and RedditReads; the Backends table above is superseded.
- 2026-11-04 night, William: option D, the product shell (above), over A (sidebar by product),
  B (agent first) and C (places by object). Site analytics backend stays for Lead tracking. "we
  can always revert if we overdo it."
- 2026-11-04 night, product shell as built:
  - Team home stays the Map; Today docks under it as a sheet, and is a place with tabs To approve,
    Messages, Mail, Calendar. Hidden there: DMs, comments, replies, mentions, issues, asks, rules,
    calls, recordings (`modules/wren/inbox.ts` holds the team inbox pages).
  - The client's Audit place is named Project: it holds the plan of any offer, not only an audit.
    `planPath(page)` in `@wren/delivery/routes` names each plan page's address.
  - Restored after the proof step, because kept parts link to them: Journeys (People tab; the Map's
    node panel and Today's "Nudge or drop" open it), Booked calls (hidden in Outbound for Wren,
    Reactivation for a client; Today's "Prepare call" and the call ping open it), Subscriptions
    (hidden in Back office; Money's "Renewing soon" opens it). The kanban board stays cut: the Map
    is the board.
  - Today's moves link to the page that counts the record (`pageOf`). A record no page counts
    makes no move.
  - Known dead links until the backend cut: pay links and form submissions on a client's timeline
    (`profiles-backfill.ts`, the inbound approval row), and the profile data catalog's traits and
    addresses lists. They go with the SMS client products and the Notes cut.

- 2026-11-04 night, backend cuts as built (tag `pre-cut-2026-11-04` holds the code before):
  - RedditReads (`dabab3df`): the loop and `wren reach discovery` go. The desk keeps its Reddit
    handlers (`desk-reddit.ts`); `src/discovery/`, the tables and autobrowse stay.
  - Meta ads (`5f845d14`): Ads, AdSpendGuard, `wren ads`, the Meta partner setup, the `paid`
    workflow and the ad report tiles go (0 rows). Meta posting for content stays; `ad_launches`
    and `ad_days` stay as tables.
  - Client SMS products (`b79d6364`): speed to lead, missed-call text back, review asks, the call
    routing setup, the phone Worker's `/r/` pages. No client had them. SmsForms stays: it is the
    lander's path into People, not a client product. Booking reminders stay with it. The Google
    Business setup stays because content reads reviews by Place ID. Every table stays.
  - Open: the one Wren door hook on prod still names `speed_to_lead.steps` (last call 10-15). The
    executor answers 410 now. Delete the row with William's yes.
  - Notes (WA-1067): the app, NotesConsole, `wren notes`, `wren tasks`, `wren train --notes`,
    quick capture and record backlinks go; `packages/notes` is deleted. Inbox thread notes and
    `@` mentions move to `@wren/starling-conversations` (`inbox/notes.ts`, `inbox/mentions.ts`,
    `inbox/mention-mail.ts`). The note box is a plain textarea: the rich editor and the `@`
    picker went with Tiptap; `@email` still tags. Mentions are record `inbox.mention`, marked read
    by `InboxDesk/mentionsRead|Unread`; mention mail links the thread. The NoteRoom Durable Object
    is deleted (wrangler migration v3; it kept nothing on disk). Ask no longer reads notes. Every
    notes table stays in `conversations/src/notes-schema.ts` until the lake; the `notes/*` S3
    grant stays while the images do.
  - SearchWatch split (WA-1067): `SiteRollup/default` takes the lander rollups (site, link,
    flag and survey days, heatmaps, `/go/` clicks), the bandit and the edge push. It is bound
    always and left stopped; it stops itself without `WREN_SITE_EXPORT_TOKEN`. SearchWatch,
    SearchWeek, the client Search watch part (0 installs), `wren search`, the `search-week`
    skill, the brief, propose, PR and citability code, the four SEO records and the report's
    search tile go. The adapter stays: the Search Console client and its setup check, `syncSearch`,
    keywords and the AI-answer reads. Every search table stays. `WREN_SEARCH_SITE`,
    `WREN_SEARCH_ORIGIN` and the search Discord lane are no longer read; delete them from SSM later.
    Restart cursors: SiteRollup reads heat and clicks from id 0 on its first pass (SearchWatch
    never ran that step on prod: no export token).
  - Dead links fixed (WA-1067): Pay links is placed in a client's Back office › Money
    (`/office/pay-links`, old `/payments/links` moves there), so the timeline's pay lines and the
    pay-link approval open. Text lines open the thread in Messages (`/today/messages/text:<id>`).
    Form and voice lines link nowhere: a form has no page of its own (its fields are the line's
    body) and voice stays parked. The Map: an ads node opens nothing while ads are cut, a DM node
    opens Today › DMs, and a Wren plan node opens Back office › Money (Deals is cut). The watch
    mail view's held link points at `/today/mail`.
  - Client People (WA-1067): People, Timeline, Groups, Broadcasts, Import and Journeys. Channels
    leaves the client, as it left Wren's: each channel's funnel is Results. Sent loses its tab
    and stays hidden: a broadcast's send log opens it. Groups and Broadcasts stay for the
    newsletter path.
  - The data index (`people.datum`) links an event kind to the timeline; a trait or an address
    kind links nowhere, as neither has a list page now.
  - Weekly report (WA-1067.2): `wren report weekly` and its collect, render, schedule and send
    code go (last row 10-03; ReportScheduler already gone). The `reports` table and its 14 rows
    stay. Cold email's variant outcomes (`report/variants.ts`) stay.
  - Parked ids out of APPS (WA-1067.2): Marketplace, Workflows, Loops, Handlers, Review, Ask and
    Learn leave `APPS`. Their records and console routes move to the place that would hold them:
    system records (holds, executions, checks, loops, flags, settings, components, handlers,
    automations, workflows) to `office`, Ask to `research`, the parked-draft review to `inbox`.
    No stored grant or token names an app (prod 11-04), so no one's access changes. Voice stays
    parked with its package.
  - Your settings comes back (WA-1067.2): the ground-up cut dropped a client's Account › Your
    settings, where each person picks the mail they get. Every portal email's footer links there,
    so the link landed on no page. It sits in a client's Back office › Team (`/office/you`), and the
    footer links there direct. The `portal` skill is rewritten for the places; README and the
    `wren` skill name the new pages.
