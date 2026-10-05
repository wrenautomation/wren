# Direction: service first, substrate second

Living doc. Started 2026-10-03 from William's notes. Revise in place and log changes at the bottom.

## The bet

Sell automation as a service. Every client is a paying beta user. Fulfillment means pulling components out of wren and autobrowse, wiring them together, and building what is missing. Whatever two clients need moves down into a shared foundation. Once enough clients run on the same parts, those parts can be sold as SaaS.

Wren is client zero. William sells the tools he runs the business on, so what he builds to see and run Wren doubles as the sales demo. Every idea below is ranked by whether it helps land or deliver client #1.

## Where we are (prod, 2026-10-03)

Recruiting firms, not declined:

| Stage | Firms |
|---|---|
| In play | 33,202 |
| Have a domain | 24,769 |
| Crawled | 24,046 |
| Named person found | 8,234 |
| Verified named lead | 4,100 |

Named people who stall after that:

| Where | Count |
|---|---|
| Lead is catch-all | 910 |
| Lead is risky (blocked, deferred, unreachable) | 840 |
| Firms whose candidates still wait in the resolution queue | 2,007 |
| Crawled firms with no named person | 16,093 |

Sending: 880 cold emails since 09-23 and 0 replies. On 10-02, Gmail put 10 of 10 test sends in spam, including a neutral two-line note. We now send about 10 a day from one inbox. At that rate, 4,100 verified named firms last over a year, so lead supply does not block revenue.

Two things block progress. Revenue waits on inbox placement, and that is mostly time while the one inbox warms up. William's own work waits on a view. The only ways into wren are Claude Code, the CLI, SQL and Discord, and a buyer can't be shown any of them. Build time goes to the view while placement heals.

## How to juggle

- One build item at a time, taken from Now in order.
- One learning item on the side. Right now that is DSL design.
- A new idea goes into Parked with a trigger before anyone works on it.
- Every Friday, refresh the numbers above and move items whose trigger fired. Once the console exists, the review happens there.

## Now

1. The console: Wren as client zero in its own portal. The portal already has app cards with glance numbers, a team view across clients, themes stored as data, run trails, tables, stat strips, and a recorder that turns screens into demo videos. What it lacks is Wren's own business. Its only client is the demo, and its apps are reactivation, delivery, ops and account.
   - One read endpoint for numbers. A Restate handler serves any allowlisted SQL view as JSON or CSV. A portal card, a CSV export and an agent all read that same endpoint, which makes every number exportable for agents. Eighteen views already exist, among them the campaign funnel, send health, replies by variant, stage costs, model calls and verification yield.
   - Team-only apps, in this order:
     - Pipeline shows the lead funnel above, per niche, with its leaks.
     - Outbound shows the campaign funnel, send health, and replies by variant with an interval, so a lucky week doesn't read as a winner.
     - Money shows spend from Books plus cost per stage and per model call. CAC, LTV and churn read delivery invoices and fill in after the first paid month.
     - Loops shows what runs, what is paused, the last run, and the pause switch.
     - Inbox holds replies waiting on William's approval, the same queue Discord and SMS ping about.
   - Charts come from Recharts, wrapped once in @wren/ui so a client theme restyles them.
   - Buttons cover only what William does daily: approve a reply, approve or skip a draft, pause a campaign. Each one calls a handler that already exists.
   - Build each app against a client id, the way reactivation reads a client's own database, so Outbound for Wren can become Outbound for client #1 without a rewrite.
2. Inbox placement. William's inbound-activity work on the one inbox is in progress. While it heals, the 163 best recruiting firms parked for new domains could get a phone call, since most firms in the list have an office phone.
3. Free lead fixes:
   - Done: the catch-all lookup index (`ix_verifications_email_domain`, on prod).
   - Done 10-04: name extraction for crawled firms with no named person, on Cohere credits (`cohere-name-extraction` in memory; recruiting and agencies both run).
   - Waiting: re-probe the 840 risky leads once the prober's PTR record lands (ticket #EF57722).
   - Decided 10-05: skip the 910 catch-all leads while one inbox sends 10 a day. Revisit when the inbox fleet lands.

## Next

4. A form for every handler. Declare each Restate handler's input with its zod schema through the SDK's `serde.schema`. Restate's admin API then serves an OpenAPI spec per service, and one portal page renders a form from it. Every handler becomes usable from the portal without a page of its own. The five apps above stay the curated views, and this page reaches everything else.
5. Turn on pg_stat_statements on the box. Moved into the database audit (`2026-10-03-database-audit.md`), which needs the same restart.
6. Done as `2026-10-04-outbound-per-client.md` (built). Client #1's fulfillment spec. It is the first real DSL: which products a client gets, wired to which foundations, plus the client's validated settings. Reactivation already has most of it.

## Building now (William's call, 10-04)

These were Later or Parked. On 10-04 William moved all of them to now, each with its own doc:

- Copy evolution: the full harness, not only Thompson sampling (`2026-10-04-copy-evolution.md`). It runs at any volume; at 10 a day it mostly explores, and a simulator compares strategies meanwhile.
- CAC, LTV and churn (`2026-10-04-unit-economics.md`). Cost per reply and per booked call show now; the client figures fill in on the first paid invoice.
- Componentizing and the marketplace (`2026-10-04-components-and-marketplace.md`, autobrowse `designs/2026-10-04-mods.md`).
- Brand palette from one color, as an option next to the presets (`2026-10-04-brand-palette.md`).

## Parked

| Idea | Unpark when |
|---|---|
| DigitalOcean move | The pg box starts billing at on-demand rates, or the AWS bill takes more than an hour a month to understand |
| Airbyte | A client's CRM or ATS has no file export we parse. Try dlt first |
| Redis or Valkey | pg_stat_statements shows a hot read an index can't fix, or two processes need a shared rate limit |
| Rotating proxies, gateway | Crawl or autobrowse logs show IP blocks at a rate worth paying for |
| Remotion | The recorder's captures don't hold up in a sales video |
| Simulated scrums | No trigger. The Friday review covers it |

## Tools

These are already in and already save custom code: Restate, Drizzle, zod, the AI SDK, DuckDB, Playwright and patchright, Langfuse, the MCP SDK in autobrowse, better-auth, Biome and Turbo. Keep them.

| Tool | For | Verdict |
|---|---|---|
| Recharts (MIT) | Portal charts | Adopt now |
| Restate `serde.schema` and admin OpenAPI | A form per handler | Adopt next |
| Metabase, Superset, Grafana | Dashboards | Skip. They add a second place to look, and a buyer would see someone else's product |
| Appsmith, ToolJet, Budibase | Admin screens | Skip for the same reasons, and they duplicate handlers |
| Twenty | CRM | Skip. It keeps a second copy of leads and replies in sync. Wren's tables plus the console are the CRM |
| tRPC with trpc-cli | One definition for CLI and API | Skip. It is a third call style next to Restate and commander |
| GrowthBook (MIT core) | Experiment stats | Skip. Bandits are paid, and it is a second UI |
| Airbyte | Client CRM sync | Parked. dlt (Apache 2.0) runs as a script with no server |
| Crawlee (Apache 2.0) | Crawling | Parked. We crawl 97% of firms with a domain |
| Valkey (BSD) | Cache | Parked |
| Remotion | Sales videos | Parked. Free for companies of up to three people |
| Material Color Utilities (Apache 2.0) | Brand palette from one color | In, for the brand palette (10-04) |
| Hetzner | Hosting | Skip. US prices rose as much as threefold in 2026, and CPX11 in Ashburn is about $20 a month |
| Coolify or Kamal | Deploys on a VPS | Only with the DigitalOcean move |

Airbyte moves data from SaaS APIs and databases into a warehouse. It does not crawl sites or read names off pages, and that reading step is where leads leak. Self-hosting it needs 4 CPUs and 8 GB of RAM, four times the pg box.

Redis would not fix the current database load, because that load comes from a missing index. Postgres already acts as our durable cache: each company is crawled once, model outputs are stored under kind, model and prompt version, and robots.txt answers are cached.

## Repos and packages

Keep the six repos. Each split follows a real boundary: autobrowse and mailifier ship to npm, keycycle ships to PyPI, lander deploys on push, and mailifier runs on its own VPS. A merge costs days and adds no view.

Inside wren, the layout already matches the bet. Foundations know no client, products never import each other, clients are data, and apps sit on top. Packaging is the missing step. Two products have a portal app, reactivation and delivery. Outreach, research, books, content, ads and the channels are reachable only through the CLI's nearly 300 commands and Claude Code.

A product counts as packaged when it has four faces: a Restate service, CLI commands, a portal app, and views for its numbers. The console work adds the portal face to the products Wren uses most. Claude Code keeps building and running them, and the portal is where William and a buyer look.

The mental load comes from how much is live, which is 24 packages for one client, more than from how many repos hold it. Fewer places to look helps more than fewer repos. The console replaces checking CLI output, SQL, Discord and the Restate UI one by one. keycycle has no importer and still runs a daily CI job, so freezing it removes one more thing to watch.

## Hosting move (parked)

If the trigger fires:

| Need | AWS now | DigitalOcean |
|---|---|---|
| Postgres + pool worker | EC2 t4g.small, 2 GB, EBS, public IP | 2 GB droplet, $12/mo |
| Files, pages, videos, backups | 5 S3 buckets, CloudFront for videos | Spaces, $5/mo for 250 GiB and 1 TiB out, S3 API |
| Restate handlers | Lambda `wren-prod-worker` and auth (free tier) | The droplet. `apps/worker/src/box.ts` already serves Restate over the tunnel |
| Secrets | SSM + KMS, used by wren, autobrowse and credvault | No equivalent. Keep SSM |
| Spend tracking | Cost Explorer into Books | DO billing API |

September's AWS bill was $8.43, and $3.08 of it was the autobrowse box, since deleted. The pg box had no compute charge in September. DigitalOcean costs about $17 a month for the same setup, about double, and Books already posts the AWS spend daily. If the pg box starts billing at on-demand rates, the two come out about even.

Order: the droplet takes Postgres and the worker first, restored from the latest dump. Then the buckets move to Spaces, which changes the endpoint and keys but not the code. Then the Lambda handlers move onto the droplet worker. SSM and KMS stay on AWS, because replacing them means rewriting credvault's backend.

## Principles

AI as compiler. A model writes a flow, a rule, a template, or a proposal row, and code runs it. A model never sits inside a per-item loop when a rule can take its place. Both repos already work this way: autobrowse explores once and compiles a workflow, and wren's enrichments are proposals that code applies. On 10-03 the email pick dropped its Cohere call for rules that cost nothing.

One definition, many faces. A handler's zod schema is the DSL. The CLI command, the portal form and the agent tool all come from it, so nothing describes the same operation twice. autobrowse already does this with `defineFlow` and `defineWorkflow`. Keep DSLs embedded in TypeScript, where types, the editor and models already work. Extract one from code that repeats, never ahead of it. Martin Fowler's "Domain-Specific Languages" is the reading for the learning lane.

## Decision log

- 2026-10-03: created from William's notes. Prod numbers pulled the same day.
- 2026-10-03: William named his own view of wren as the bottleneck, and that view is also the sales demo. The console moved to Now #1. Metabase was dropped because it would be a second place to look. The DigitalOcean move was parked, since it about doubles today's bill and Books already makes the bill readable. Open-source alternatives were checked, with verdicts under Tools.
- 2026-10-03: before the console, a database audit (`2026-10-03-database-audit.md`). The console's stack and patterns are in `2026-10-03-console-ui.md`: shadcn/ui on Base UI, composite pages of widgets, one access check that can later carry paid features.
- 2026-10-04: William changed the call on Later and Parked: copy evolution, CAC/LTV/churn, componentizing, the marketplace and the brand palette are built now, not deferred. Each has a doc dated 10-04. He also approved spending Cohere credits on simple model tasks, name extraction first.
- 2026-10-05: audit against William's notes. Now #3 closed except the PTR re-probe. Catch-alls skipped until the fleet. Next #6 covered by outbound-per-client. New docs from his 10-05 asks: `2026-10-05-access.md` (roles and RBAC), `2026-10-05-marketing-app.md`, `2026-10-05-restate-self-host.md` (Restate moves to the pg box, with the cuts), and autobrowse `designs/2026-10-05-teach-mode.md` (teach a chore by hand, replay it as a walk).
