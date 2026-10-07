# Product audit vs GoHighLevel, Zapier, Make

Living doc. 2026-10-07. William: "yeah steal all the stuff. i don't want to embed builders." Zapier app: on hold ("im not sure about zapier"). Mail read gates: fine if we automate the client-side setup after signup.

Build order (one builder each, max 4 at once): 1+8 outbound webhooks and replay; 3+4 missed-call text-back and review requests; 5+7 hosted forms and text-to-pay; 6 reply from the Inbox; mail access setup (Google Workspace admin trust, Microsoft admin consent) as setup workflows.

# Product audit: Wren vs GoHighLevel, Zapier, Make

Checked 2026-10-07. Wren facts come from the repos. Vendor facts come from official pages unless marked (unverified).

## Answer first

- The engine is already on par for our use: spine, door, canvas, executions, retry, template install (GHL's snapshot), custom domains, roles, audit.
- The gaps that cost deals are small and sit at the edges: events out of Wren, a Zapier app, the SMB staples (missed-call text-back, review requests, text-to-pay, forms), replying from one inbox, replay, and version restore.
- Don't chase app count. Zapier lists 10,000+ apps. A private Zapier app on top of outbound webhooks gets clients most of that for about a week of work.
- Skip site and funnel builders, courses, communities, affiliate, stores and self-serve SaaS mode. They are large builds and not what a high-ticket SMB client buys from us.
- Integrations: n8n and Activepieces can't be our client-facing builder without paid OEM or Enterprise deals. Nango's free self-host covers OAuth and a proxy only. Gmail read access needs a yearly CASA assessment unless the client's Workspace admin trusts our app.

## What we have (baseline)

| App | Pages |
|---|---|
| Outbound | Overview, Campaigns, Inboxes, Signals, Variants, Experiments, Copy candidates |
| Inbox | Waiting on you (email, text and DM replies), Mentions, Email replies, Your mail, Mail rules, Worth reading, Feeds |
| Marketing | Drafts, Posts, Comments, Videos, Topics, People, DMs, Invites, Followers, Subscribers, Threads, Places, Texts, Ads, Site, Funnel, Sessions, Heatmaps, Experiments, Surveys, Search, Keywords, AI answers |
| Texts | Overview, Threads, Speed to lead |
| Calendar, Calls | Schedule, Calls, pre-call brief, call outcome |
| Voice | Test call, Calls, Latency, Agent (in development) |
| Reactivation | Run, People, Emails, Replies, Keep, Setup |
| Your project (client) | Plan, Updates, Needs you, Paperwork, Deliverables, Results, Contract |
| Account, Access | People, Look, Domain, Accounts, Vendors, Billing, Changes; Roles, Grants, Access review |
| Library, Marketplace | Templates, Sequences, Snippets, Media, SOPs, Workflows; Catalog, Map, Browser mods |
| Workflows | Canvas, Executions, Events, Holds, Checks |
| Notes | Notes, Mentions |
| Wren only | Loops, Money, Pipeline (research funnel), Lead sheet, Clients (Health, Flags), Team, Review, Handlers, Ask |

Engine and plumbing:

- Spine (`packages/core/src/spine.ts`): `events` table, walker inside Restate, waits as delayed calls, wires with plain-words rules judged by a model, failed steps kept with Retry.
- Door: `POST /hooks/<token>` takes JSON or a form, one token per client, workflow and input.
- Custom step: an https URL gets `{port, event}` and answers `{out}`.
- Template install (10-07) lands parts, settings, copy, a draft workflow and a closed door on a client.
- Editor (`designs/2026-10-06-workflow-editor.md`) is half built: palette, logic nodes, draft and publish, dry test.
- Integrations: autobrowse site facades for `linkedin`, `youtube`, `instagram`, `tiktok`, `outlook`, `gmail`, `drive`, `meta`, `x`, `discord`, `langfuse` and `web` (Exa). Browser flows cover anything without an API. Instagram, TikTok, Outlook, Meta and X are unproven until a developer app exists.
- Setups and vendors: account registry, setup workflows, own key vs managed by Wren, usage metered per client, draft usage lines in Books at cost plus markup.
- Money: Wise invoices and reminders in Billing, Stripe card link fallback, one contract template for Wren's own engagements.

## Task 1: gaps, ranked

### Steal now (S effort, high value)

| # | Steal | They have | We have / gap | Value to a high-ticket SMB agency | Effort |
|---|---|---|---|---|---|
| 1 | **Outbound webhooks**: a "Send webhook" node and per-client event subscriptions, signed, retried, logged | GHL "Custom Webhook" premium action, $0.01 per execution ([changelog](https://ideas.gohighlevel.com/changelog/new-workflow-pricing-categories-premium-features-ai-models)). Zapier "Webhooks by Zapier" POST, PUT, Custom Request ([help](https://help.zapier.com/hc/en-us/articles/8496326446989-Send-webhooks-in-Zaps)). Make HTTP "Make a request" ([docs](https://apps.make.com/http)) | Custom step is request and response inside one workflow. No "on booked, POST to the client's URL" with HMAC, retries and a delivery log | Every client has a CRM or a Zap already. Their tools hear booked, replied and won without us building each integration | S. The spine already emits the events; this is a part plus a log |
| 2 | **Wren Zapier app, private first** | Zapier private integration: free, no review, up to 100 users by invite ([docs](https://docs.zapier.com/platform/quickstart/private-vs-public-integrations)). 10,000+ apps behind it ([directory](https://zapier.com/apps)) | No Zapier or Make presence | Clients reach any app they use, and they pay their own Zapier tasks | S. Triggers are REST hooks onto #1. Actions post to the door. Platform CLI |
| 3 | **Missed-call text-back** template | GHL "Missed Call Text Back" ([help](https://help.gohighlevel.com/support/solutions/articles/48001239140)) | Telnyx numbers, SMS sender, speed-to-lead steps. No missed-call trigger | The classic SMB win. It shows well on a sales call | S. A Telnyx call-status event into the door, then speed to lead's first text |
| 4 | **Review requests** template | GHL "Send Review Request" action, review widgets, Reviews AI at $0.01 per reply ([help](https://help.gohighlevel.com/support/solutions/articles/155000005156), [reputation](https://help.gohighlevel.com/support/solutions/articles/155000003397)) | We ask our own clients for reviews of Wren. Nothing asks a client's customers | Google rating drives local calls | S. Trigger on Won or job done, text and email the review link, one reminder. Never gate by rating: Google bans "selectively soliciting positive reviews" ([policy](https://support.google.com/contributionpolicy/answer/7400114)) |
| 5 | **Hosted forms on the door** | GHL Forms, Surveys, Quizzes with "Conditional Logic v2" ([help](https://help.gohighlevel.com/support/solutions/articles/155000005564-conditional-logic-in-surveys)). Zapier Forms, renamed from Interfaces 2026-05-29 ([help](https://help.zapier.com/hc/en-us/articles/14490267815949)). Make has none native | Lander forms already have Turnstile, a honeypot, consent, UTM touch and the door forward (`lander/functions/_shared/form.ts`, `door.ts`). Clients get none without code | Every speed-to-lead install needs an entry point. Many SMBs have no CRM form | S. Render fields from the door input, hosted on the client's domain plus an embed snippet |
| 6 | **Reply from the unified inbox**, with internal notes and an assignee | GHL Conversations: SMS, email, FB, IG, WhatsApp, TikTok, live chat ([help](https://help.gohighlevel.com/support/solutions/articles/155000006703-tiktok-dms-comment-automations)). "Internal Comments" with @mentions ([help](https://help.gohighlevel.com/support/solutions/articles/155000003877-conversations-adding-internal-comments-and-mentioning-users)) | "Waiting on you" lists every channel. Answering still happens on each channel's page | The inbox is the screen an SMB owner opens every day | S. Each channel's send path exists (email approve, `sms.reply`, `marketing.dmReply`). Mentions exist in Notes |
| 7 | **Text-to-pay and payment links** on the client's Stripe | GHL "Text-to-Pay", Payment Links, Invoices, Tap to Pay ([help](https://help.gohighlevel.com/support/solutions/articles/48001202185), [providers](https://help.gohighlevel.com/support/solutions/articles/155000006075-supported-payment-providers-methods-by-product-area-what-works-where)) | Wise invoices for Wren's own billing only | Deposits and invoices collected in the text thread | S. Stripe Payment Links API on the client's own key, then `checkout.session.completed` into the door as an `invoice` event ([Stripe](https://docs.stripe.com/payment-links/api)). The own-key vendor mode exists |
| 8 | **Auto-replay, bulk replay, error digest** | Zapier "Autoreplay" (5 tries: 5 min, 30 min, 1 h, 3 h, 6 h), Replay, error notifications ([autoreplay](https://help.zapier.com/hc/en-us/articles/19220226086797), [notifications](https://help.zapier.com/hc/en-us/articles/8496289225229)). Make error handlers (Skip, Retry, Resume, Commit, Rollback) and "Incomplete executions" ([docs](https://help.make.com/error-handlers), [docs](https://help.make.com/incomplete-executions)). GHL Execution Logs ([changelog](https://ideas.gohighlevel.com/changelog/execution-logs-enrolment-history-enhancements)) | Events app: Failed, Waiting, All. Retry per event. A step stops after 3 failures | A vendor outage at 3am heals itself, and the owner learns it in one line | S. A backoff ladder of delayed `Spine/retry`, "Replay all failed" on a filtered list, a daily digest through the notifier |
| 9 | **Workflow version list and restore** | Zapier version rollback, kept 1 month on Pro, 6 on Team, 1 year on Enterprise ([help](https://help.zapier.com/hc/en-us/articles/14094586364941-Restore-your-Zap-to-a-prior-version-with-version-rollback)). Make previous versions, 60 days ([help](https://help.make.com/restore-and-recover-scenario)). GHL "Version History & Restore", 10 versions or 30 days, in Labs ([help](https://help.gohighlevel.com/support/solutions/articles/155000006656)) | Every save is already a `workflow_saves` row. No list or restore ("Not yet: a list of past versions") | Safe edits on live client workflows | S. List, diff, "Restore as draft" |
| 10 | **Installable portal with Web Push** | GHL LeadConnector mobile app ([help](https://help.gohighlevel.com/en/support/solutions/articles/155000001702)). White-label app at $497/mo ([help](https://help.gohighlevel.com/support/solutions/articles/155000007149-self-service-whitelabelled-mobile-app-customizer)) | Portal works at 375px. No push | Speed to lead's "Call now" works only if the rep sees it within seconds | S. Manifest, service worker, Web Push. iOS supports it for home screen web apps since 16.4 ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)) |
| 11 | **Code-checked filters on wires** | Zapier Filters and Paths, 10 branches, 3 levels ([help](https://help.zapier.com/hc/en-us/articles/8496288555917)). Make Router with a fallback route, If-else and Merge ([docs](https://help.make.com/router), [docs](https://help.make.com/if-else-and-merge)). GHL If/Else ([help](https://help.gohighlevel.com/support/solutions/articles/155000002294)) | Wire rules are plain words judged by a model. If, Switch, Split, Merge are planned | Field checks cost $0 and are never wrong. A model call per event is both | S. Field, operator, value, checked in code first. Plain words stays the fallback |

### Next (M effort, or waits on an approval)

| Item | They have | We have / gap | Value | Effort |
|---|---|---|---|---|
| Opportunities board for clients | GHL "Opportunities and Pipelines", "Opportunity Smart Lists" ([help](https://help.gohighlevel.com/support/solutions/articles/155000007734-smart-lists-in-opportunities)) | Pipeline app is our research funnel. Calls have outcomes. No deal stages | High. Owners judge us by deals they can see | M. Board view on the records layer, stage changes as spine events |
| AI workflow builder | GHL "Workflow AI Builder" ([help](https://help.gohighlevel.com/support/solutions/articles/155000006100-workflow-ai-builder)). Zapier Copilot ([help](https://help.zapier.com/hc/en-us/articles/38215656607757)). "Maia by Make" ([help](https://help.make.com/introduction-to-maia-by-make)) | "Ask Claude on the graph" planned in editor step 3. Ask is read only | High for us, medium for clients | M |
| Inline code step | GHL "Custom Code" in JS and Python ([help](https://help.gohighlevel.com/support/solutions/articles/155000003362-workflow-action-custom-code)). Code by Zapier ([help](https://help.zapier.com/hc/en-us/articles/45405528551181)). Make Code app, 2 credits per second ([help](https://help.make.com/the-make-code-app-is-available)) | Custom step needs a hosted https URL | Medium. Cuts one-off glue from hours to minutes | M. A sandbox such as a Worker per step |
| Custom fields and custom values | GHL Custom Fields, Custom Values, Custom Objects, Associations ([help](https://help.gohighlevel.com/support/solutions/articles/155000003896-getting-started-with-custom-objects)). Zapier Tables ([help](https://help.zapier.com/hc/en-us/articles/9804340895245)). Make Data stores ([help](https://help.make.com/l6du-data-stores)) | Fixed schema per client database. AI fills slots | Medium. Copy needs business facts ({{business.phone}}) and per-client fields | M for fields and values. L for custom objects |
| More channels: WhatsApp, RCS, site chat | GHL WhatsApp at $10/mo plus Meta fees ([help](https://help.gohighlevel.com/en/support/solutions/articles/155000001428-whatsapp-pricing-billing-and-rebilling-guide)). RCS ([help](https://help.gohighlevel.com/support/solutions/articles/155000007782-rcs-in-highlevel)). Live chat in Conversations | Email, SMS, LinkedIn and Reddit DMs, IG and FB comments | Medium. WhatsApp matters for non-US clients | M. WhatsApp needs Meta Tech Provider review (Task 2) |
| Review reading and AI replies | GHL Reviews AI on Google Business Profile and Facebook ([help](https://help.gohighlevel.com/support/solutions/articles/155000005156)) | None | Medium after #4 | M. GBP API needs a profile verified 60+ days and an approved access form ([Google](https://developers.google.com/my-business/content/prereqs)) |
| Documents, e-sign, estimates for clients | GHL "Documents & Contracts" ([help](https://help.gohighlevel.com/support/solutions/articles/155000000594-how-to-use-documents-contracts-)), "Proposals & Estimates" ([changelog](https://ideas.gohighlevel.com/changelog/proposals-and-estimates-live-under-payments)) | One contract template, for Wren's own deals | Medium | M. Generalize `packages/delivery/src/contract.ts` |
| Client lead-source report and scheduled sends | GHL Custom Dashboards with scheduled report delivery ([help](https://help.gohighlevel.com/support/solutions/articles/155000001531)), Lead Source Report | Friday digest, Results, Health, first and last touch on the lander | Medium. Retention | S to M |
| Auto-reply modes | GHL Conversation AI: Off, Suggestive, Auto-Pilot ([help](https://help.gohighlevel.com/support/solutions/articles/155000001335-conversation-ai-bot-explained)) | Drafts wait on approval (our rule). That matches "Suggestive" | Medium. Auto-Pilot only per client, within limits, and only if William allows it | M |
| MCP server over Handlers | Zapier MCP, 2 tasks per call ([help](https://help.zapier.com/hc/en-us/articles/45645738385805)). Make MCP server ([docs](https://developers.make.com/mcp-server/make-mcp-server)) | Handlers app already has every handler's zod schema. autobrowse MCP is a leftover | Medium. Agents, Claude and clients' AI tools can drive Wren | S to M |
| "Wait until event" | Zapier "Delay Until" ([help](https://help.zapier.com/hc/en-us/articles/8496288754829)). GHL "Goal Event" ([help](https://help.gohighlevel.com/support/solutions/articles/155000003328)) | "until" waits are refused today. Awakeables unused. Cadences already stop on reply | Medium | S to M |
| Make custom app | Make Custom Apps, VS Code SDK ([docs](https://developers.make.com/custom-apps-documentation/app-visibility)) | None | Low to medium, after Zapier | M. Review takes weeks, and a public app can't be unpublished |
| Public template gallery on the lander | Zapier templates directory ([site](https://zapier.com/templates)). Make lists 8,292 templates ([site](https://www.make.com/en/templates)) | Catalog is inside the portal | Medium. SEO and sales proof | S |
| Connector layer for client SaaS (HubSpot, QuickBooks, Jobber) | GHL native QuickBooks, Shopify, WooCommerce ([help](https://help.gohighlevel.com/support/solutions/articles/48001153903)) | Site facades for our own channels only | Medium | M. Nango self-host or Composio (Task 2) |
| Rebilling as real invoices | GHL rebilling with markup on Agency Pro ([help](https://help.gohighlevel.com/support/solutions/articles/155000002095-rebilling-reselling-and-wallets-explained)) | Usage metered per client, draft lines only | Medium. Margin on SMS, AI, voice | M |

### Skip (why)

| Item | They have | Why skip |
|---|---|---|
| Site and funnel builder | GHL "Funnels & Websites" and its AI ([help](https://help.gohighlevel.com/support/solutions/articles/155000006713-funnels-websites-ai)) | L build, a commodity. We do pages for clients from lander code on their custom domain |
| Memberships, courses, certificates | GHL Courses and Certificates ([triggers](https://help.gohighlevel.com/support/solutions/articles/155000002292-a-list-of-workflow-triggers)) | Not what a client buys from a done-for-you agency. L |
| Communities | GHL Communities, GoKollab ([changelog](https://ideas.gohighlevel.com/changelog/communities-ui-new-experience-inside-unified-clientportal-and-gokollab)) | Skool and Discord exist. Our Discord site is already wired |
| Affiliate manager | GHL "Affiliate Manager", up to 7 tiers ([help](https://help.gohighlevel.com/support/solutions/articles/155000003648)) | Low value for SMB service clients. `/go/` links cover Wren's own referrals |
| Stores, POS, Tap to Pay | GHL Ecommerce Stores ([help](https://help.gohighlevel.com/support/solutions/articles/155000006618-shipping-profiles-custom-shipping-rates-and-app-integrations)), Tap to Pay ([help](https://help.gohighlevel.com/support/solutions/articles/155000005506-tap-to-pay-on-square-for-pos-and-mobile-payments)) | Wrong client shape |
| Self-serve SaaS mode | GHL "SaaS Configurator", Agency Pro $497/mo ([changelog](https://ideas.gohighlevel.com/changelog/saas-mode-v2-a-revamped-saas-configurator-for-better-monetization-and-flexibilit), [pricing](https://www.gohighlevel.com/pricing)) | We sell done-for-you at $1.5k and up, and the portal is invite only. Revisit when parts sell as SaaS |
| White-label native app | GHL, $497/mo ([help](https://help.gohighlevel.com/support/solutions/articles/155000007149-self-service-whitelabelled-mobile-app-customizer)) | Steal #10 (PWA plus push) covers it. Look and custom domains are done |
| Matching app count natively | Zapier 10,000+ apps, Make 3,620 ([directory](https://www.make.com/en/integrations)), GHL marketplace about 1,273 listings (unverified, [third party](https://appmarketplace.com/marketplaces/highlevel-marketplace)) | We can't catch up. Steals #1 and #2 get most of it |
| Data tables as a product | Zapier Tables, Make Data stores | Clients don't build. Postgres per client covers it, and custom fields are in Next |
| Client-facing agent builder | GHL "Agent Studio" ([help](https://help.gohighlevel.com/support/solutions/articles/155000007393-agent-studio-overview)), Zapier Agents ([site](https://zapier.com/agents)), Make AI Agent ([help](https://help.make.com/introduction-to-make-ai-agent-new)) | We build the agents for clients. Ask, voice, Monitor and AI fills are ours |
| Make Grid | Map of scenarios and apps ([help](https://help.make.com/introduction-to-make-grid)) | Marketplace > Map and the canvas already do this |
| Embedding n8n, Activepieces, Merge or Paragon | See Task 2 | The license, price or fit is wrong, and the spine and editor already exist |

### Area index

| Area | Verdict |
|---|---|
| Trigger and action breadth, app directory | GHL lists 91 triggers and 68 actions ([triggers](https://help.gohighlevel.com/support/solutions/articles/155000002292-a-list-of-workflow-triggers), [actions](https://help.gohighlevel.com/support/solutions/articles/155000002294)). Ours: event kinds, catalog parts, about 12 site APIs, browser for the rest. Steals #1, #2 |
| Webhooks in and out | In: the door is on par. Out: steal #1 |
| Data stores and tables | Next (custom fields). Skip tables as a product |
| Routers, filters, paths | Steal #11. Logic nodes are already planned |
| Error handling and replay | Steal #8 |
| Versioning | Steal #9 |
| Templates marketplace | Template install is done. Public gallery is Next |
| AI steps and agents | Ours lead on research, fills and triage. AI builder and MCP are Next. Agent builder is skipped |
| Forms and surveys | Steal #5. Surveys are building |
| Funnels and sites | Skip |
| Memberships and courses | Skip |
| Reputation and reviews | Steal #4. Reading and replies are Next |
| Payments, invoices, text-to-pay | Steal #7. Documents and e-sign are Next |
| Conversations inbox | Steal #6. More channels are Next |
| Pipeline and opportunities | Next |
| Snapshots and SaaS mode | Snapshots done (template install). Rebilling is Next. SaaS mode is skipped |
| White label | Done (Look, custom domains). Native app skipped |
| Mobile app | Steal #10 |
| Reporting | Next |
| Affiliate | Skip |
| Communities | Skip |

Prices for reference:
- GHL: Starter $97/mo, Unlimited $297, Agency Pro $497 ([pricing](https://www.gohighlevel.com/pricing)). AI Employee is $50 or $97 per sub-account ([help](https://help.gohighlevel.com/support/solutions/articles/155000006652-ai-products-pricing)). Workflow premium actions are $0.01 per execution.
- Zapier: Professional from $19.99/mo for 750 tasks, Team from $69 ([pricing](https://zapier.com/pricing)).
- Make: Core $9, Pro $16, Teams $29 a month for 10k credits, billed annually. Credits replaced operations on 2025-08-27 ([credits](https://www.make.com/en/credits)).

## Task 2: third-party integrations

### Embed or self-host platforms

| Vendor | License | Can a commercial SaaS embed or self-host it? | Price now | What it does | Apps |
|---|---|---|---|---|---|
| Nango | Elastic License 2.0, the whole repo ([LICENSE](https://raw.githubusercontent.com/NangoHQ/nango/master/LICENSE)) | Yes, behind our product. ELv2 bans offering Nango itself as a hosted service. Free self-host is auth and proxy only. Syncs, actions, webhooks and MCP need Enterprise ([docs](https://nango.dev/docs/guides/platform/self-hosting)) | Free: 10 connections. Pay as you go: $50/mo plus $0.29 per connection. Growth add-on $450/mo ([pricing](https://www.nango.dev/pricing)) | OAuth, token refresh, syncs, actions, unified API, proxy, MCP | 1,000+ APIs |
| Pipedream Connect | Proprietary. The component repo's license bans commercial use ([LICENSE](https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/LICENSE)) | Embed yes, hosted only. No self-host. Workday closed its acquisition of Pipedream by 2026-01-31 ([8-K](https://www.sec.gov/Archives/edgar/data/1327811/000132781126000010/wday-01312026x991.htm)) | Startup $99/mo annual or $150 monthly: 100 users, then $2 each ([pricing](https://pipedream.com/pricing)) | Managed auth, actions, triggers, MCP, proxy | 3,000+ APIs |
| Composio | SDK under MIT. Platform proprietary | Embed yes. Self-host on Enterprise only ([enterprise](https://composio.dev/enterprise)) | Free: 100k tool calls a month. Pro: $29/mo, then $0.0003 per call ([pricing](https://composio.dev/pricing)) | Managed OAuth, agent tools, triggers, hosted MCP | 1,602 toolkits |
| Activepieces | MIT, except `ee` folders under a commercial license ([LICENSE](https://raw.githubusercontent.com/activepieces/activepieces/main/LICENSE)) | MIT core is free for any use. Embedding is Enterprise only ([docs](https://www.activepieces.com/docs/embedding/overview)) | Cloud from $0. Embed from $36k/yr ([embed](https://www.activepieces.com/embed)) | Flow builder, connections, MCP | 765 pieces |
| n8n | Sustainable Use License, plus the n8n Enterprise License on `.ee.` files ([LICENSE](https://raw.githubusercontent.com/n8n-io/n8n/master/LICENSE.md)) | Allowed: workflows we build for clients that they can't edit, and clients connecting their own accounts. Banned without a deal: a client-facing builder, hosting n8n as a service, white-label ([FAQ](https://docs.n8n.io/n8n-community-license/community-license/license-faq)). OEM keeps n8n branding, no public price ([OEM](https://n8n.io/oem/)) | Cloud in EUR: Starter €20/mo, Pro €50, Business €667 ([pricing](https://n8n.io/pricing/)) | Workflows, AI agent nodes, MCP | 2,329 |
| Paragon | Proprietary. Its MCP server is open source | Embed yes. Self-host on Enterprise ([hosting](https://www.useparagon.com/hosting-options)) | No public price ([pricing](https://www.useparagon.com/pricing)) | Auth, proxy, Managed Sync, ActionKit, MCP | 130+ |
| Merge | Proprietary | Embed yes. On-prem for Agent Handler Enterprise | First 3 linked accounts free. $650/mo up to 10, then $65 each ([pricing](https://www.merge.dev/pricing/unified)). Agent Handler Pro $1,000/mo | Unified API in 9 categories (CRM, ATS, HRIS...), MCP | No exact count |

Fit for us:
- Nango self-host is the only free embeddable token manager. Use it if clients ask for many SaaS connections. Our own OAuth flows already cover our channels.
- Composio is the cheap hosted path for agent tool calls.
- Merge and Paragon target B2B SaaS vendors syncing categories like HR and ATS. Wrong price and fit for per-client automation.

### Publishing our own app

| Program | Steps | Time | Cost | Gate |
|---|---|---|---|---|
| Zapier private integration | Build in Platform UI or CLI, invite users ([docs](https://docs.zapier.com/platform/quickstart/private-vs-public-integrations)) | Instant | Free | Up to 100 users by invite. No templates, embed or MCP |
| Zapier public integration | Submit for review. Zapier answers in 1 week or less. 90 days of Beta, then public ([docs](https://docs.zapier.com/integrations/publish/public-integration)) | 1 week, plus 90 days of Beta | Free | Publicly launched app, HTTPS, every trigger and action run once, a test account, public API docs ([requirements](https://docs.zapier.com/integrations/publish/integration-publishing-requirements)) |
| Zapier Partner Program | Bronze, Silver, Gold, Platinum. Silver needs 50 active users, Gold 350, Platinum 3,000 ([tiers](https://docs.zapier.com/platform/publish/partner-program)) | Quarterly | Free | Health score |
| Zapier embed ("Powered by Zapier") | Workflow Element, Workflow API, Actions with managed auth ([docs](https://docs.zapier.com/powered-by-zapier/introduction)). White Label is early access: end users need no Zapier account, partner billed per task ([docs](https://docs.zapier.com/white-label)) | Not stated | End users pay their own plan, or we sponsor tasks ([docs](https://docs.zapier.com/powered-by-zapier/covering-costs)) | Public listing first |
| Make custom app | Private, Public (invite link, can't unpublish), Approved (listed after review) ([docs](https://developers.make.com/custom-apps-documentation/app-visibility)). Review: form, auto review, manual QA, test account ([docs](https://developers.make.com/custom-apps-documentation/app-review/request-app-review)) | Weeks (unverified, [forum](https://community.make.com/t/custom-app-review-pending-for-3-weeks-no-response-memoket-us2/113250)) | No fee stated. Technology Partner Program is free ([page](https://make.com/en/technology-partners)) | Service not already on Make. Error handling, pagination, universal module, test scenarios ([docs](https://developers.make.com/custom-apps-documentation/app-review/prerequisites)) |

### OAuth app verification

| Program | Cost | Time | Gate |
|---|---|---|---|
| Google, sensitive scopes (`gmail.send`) | Free | About 10 business days ([FAQ](https://support.google.com/cloud/answer/13463817)) | Brand verification, demo video, scope justification |
| Google, restricted scopes (`gmail.readonly`, `gmail.modify`, `gmail.metadata`; [list](https://developers.google.com/workspace/gmail/api/auth/scopes)) | Google charges nothing. Lab fee: TAC Security AL1 from $675, Enterprise AL2 $5,400/yr ([TAC](https://casa.tacsecurity.com/site/home)) | About 6 weeks, plus 2-4 weeks at the lab. Repeats every 12 months ([docs](https://support.google.com/cloud/answer/13463816)) | CASA Letter of Validation from an authorized lab ([labs](https://www.appdefensealliance.org/certification/authorized-labs)) |
| Google, no verification needed | Free | None | Internal apps. Apps a client's Workspace admin trusts in the Admin console. Under 100 users, a lifetime cap that can't be reset ([docs](https://support.google.com/cloud/answer/13464323)) |
| Meta, Advanced Access and App Review | No fee found (unverified) | Decision within a week. Business verification up to 14 business days (unverified) ([guide](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide)) | Business Verification. A video per permission. `ads_management` and `leads_retrieval` need review ([permissions](https://developers.facebook.com/documentation/development/permissions)). Yearly Data Use Checkup |
| Meta, WhatsApp Tech Provider | No fee found | Review averages about 24 hours | Business verification, two review videos ([docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)). Clients add their own payment method |
| LinkedIn, Sign In and Share on LinkedIn | Free | Instant | None. Posts only as the member, 150 a day ([docs](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin)) |
| LinkedIn, Community Management API (Page posts, comments) | No fee | No SLA | Legal entity, business email, a Page super admin verifies a dedicated app. Development tier is 500 calls a day. Standard tier is due within 12 months ([docs](https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review)) |
| LinkedIn, Lead Sync, Advertising API | No fee | No SLA | Same verification checks. Ads development tier covers 5 ad accounts ([docs](https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access)) |
| LinkedIn, Sales Navigator (SNAP) | n/a | n/a | "Not currently accepting new partners" ([docs](https://learn.microsoft.com/en-us/linkedin/sales/)) |
| Microsoft publisher verification | Free | Minutes once the partner account is verified | Microsoft AI Cloud Partner Program ID, verified domain ([docs](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)) |
| Microsoft 365 Certification | Paid to Claranet, no public price | About 60 days, yearly ([FAQ](https://learn.microsoft.com/en-us/microsoft-365-app-certification/docs/certfaq)) | Publisher verification, attestation, pen test |

Rules that shape our builds:
- Gmail read for a client mailbox means CASA every year. Two ways around it: the client's Workspace admin trusts our app, or we stay on `gmail.send`, which is sensitive and needs no CASA.
- Microsoft's default consent policy, rolled out Oct-Nov 2025, stops users consenting to `Mail.Read`, `Mail.ReadWrite` and `Calendars.*` ([docs](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies)). Every client's admin must consent, verified publisher or not. `Mail.Send` is not on that list.
- Posting to a client's LinkedIn Page needs Community Management approval on a dedicated app. Member posting is self-serve.
