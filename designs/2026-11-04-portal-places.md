# Portal places: eight tabs, one home per object

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

## Target

The sidebar:

| Place | Holds | One-line test |
|---|---|---|
| **Map** | The business: offers and terms, the shape (metro map), business numbers and reports, the playbook | What we sell, how it flows, what it earns, how we do it |
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
| analytics | search days, search, keywords, AI answers | Map › Numbers › Search |
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
| marketing | search, keywords | Map › Numbers › Search |
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

Rule (William, 11-04): what is unused or badly designed goes now, and is rebuilt later. Nothing
waits for its replacement. Git keeps the code; the lake keeps the data. Two guards:
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
| Workflows, Loops | The portal apps | CLI verbs. A `wren loops flag` verb comes in the same change, as the kill switch and `POST_NOW_FLAG` have no other writer |
| Ask | The Ask app | `wren agent`; the chat panel |
| Leads | The lead sheet (team `leads`, outbound `sheet`) | People |
| Client SMS products | Speed to lead, missed calls, review asks, booking reminders, form texts (`sms reminders`, `sms forms`), SmsWatch's client passes | The SMS adapter and cold SMS, for campaigns (reactivation) |
| Loops | RedditReads and its CLI verb; the stopped keys of retired niches (ComposeScheduler, PoolScheduler `agencies`, `sec_ria`) and of the 10 retired senders; `report weekly` | Autobrowse Reddit flows and the `starling-reddit` adapter. SetupWatch: Back office › Channels needs it |
| CLI | Each command of a removed part, found by a reader check | `video *` for now (a redesign later) |
| Skills | `portal` rewritten for the places; `wren` trimmed to what stays | `research`, `lander`, `wren-ui`, `search-week` |

Open (William): the cold email engine and Books. See Open picks.

Loops kept: the running set above. The other stopped loops restart with their place, or go with
their part.

## Phases

UI follows the design-language artifact (`designs/2026-10-20-design-language/`) and the `ui-design`
proof step.

1. **Places and moves.**
   - `areas.ts` becomes the eight places for team and client, with the client sidebar and the phone
     dock above.
   - Pages move to their place's app id. Old links go in `moved.ts`, and every href in code moves
     too (`moved-guard.mjs`). `CLIENT_HELD` grows for each shared id that moves.
   - Grants and the route inventory move to the new ids (`core/src/access.ts` `APPS`). Prod
     `grants` is empty, so no data moves.
   - Holds show in Inbox.
   - The removed apps leave the nav.
   - Done when: the sidebar shows the places in both workspaces and on the phone; every old link
     lands (`moved.test.ts`); grants and the route inventory pass on the new ids.
2. **Deletes.** The Removals table, right after phase 1. Exact CLI paths after a reader check
   per command. Learn's SOP half moves to the Playbook in the same change.
   - Done when: no code, route, loop key or skill of a removed part is left; `knip` is clean.
3. **Map and Back office.** Map › Offers, Numbers (search, reports), Playbook. Back office ›
   Money, Documents, Team and Access, Channels, Products (read only), Settings, the health line.
4. **Campaigns place.** List and campaign page from the metro groups: overview, channels, landers,
   rules, budget, results. The stamps it needs, each with its writer: a lander's campaign
   (`sites` pages), auto-reply and keyword-DM rules per campaign. The campaign filter.
   - Done when: a campaign's channels, landers, rules and results show on one page; the filter
     scopes People, Content, Inbox and Calendar.
5. **Content and Studio.** Studio is the piece page: player, micro edits, annotations (the `video`
   editor verbs behind it).
6. **People.** Clients, the board, companies, calls, recordings and form answers on the person.
7. **Inbox and Calendar.** Inbox › Today, approvals, holds, DMs, comments, reviews, mentions.
   Calendar shows every dated thing and opens its home.
8. **Chat panel and Research.** `AgentPanel` on every page with page context; Research is
   Birdwatch only.
9. **Products and teasers.** First the map of product → components → sections. Then each locked
   section teases, and Today's add-on cards point to them.

Experiments: its own design doc and phases, after phase 4.

## Open picks (William)

1. **Cold email engine.** It drafts openers, waits for a yes (`wren email` review seat, Inbox › To
   approve), then sends from warmed inboxes. It was reworked around campaigns on 11-02
   (`enrollments.campaign`, the `@wren/experiments` bandit picks copy). My pick: keep it whole and
   paused; rebuild only its UI in Campaigns. Other choice: delete compose, review and sequences as
   one unit and keep the inbox setup (domains, warm-up, placement).
2. **Books.** It reads the AWS bill, the card and payments into one ledger: the data behind Money.
   My pick: keep the pipe and redesign Money's pages. Other choice: delete it; Money starts empty.
3. **SEO.** Search pages in Map › Numbers and `search-week` stay while SEO is a channel. Confirm.

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
