# In-house tools: what each one replaces (2026-10-06)

William, 10-06: "for all the services / bundles we made that are essentially free in house
customized versions of existing saas services, note that down somewhere. just for bookkeeping
sake, and also use that as subtle marketing in the panel".

## One list, in code

`packages/core/src/in-house.ts` holds one entry per tool we built:

- what it is, and the Shop part or app it lives in;
- the SaaS it replaces: one or two names, each with its plan, its price, the unit (a month, a
  seat, 1k events), a source URL and an as-of date;
- what it costs us (usually $0), and why;
- its state: live, building or in development.

Prices come only from the vendor's own pricing page, with the URL and the date. With no
public price, the entry says "custom pricing" and adds no number. A test fails any entry with
no source.

## The list

| Ours | Instead of | State |
|---|---|---|
| Signals: events, funnels, session replay | PostHog, FullStory | live |
| Heatmaps | Hotjar | building |
| Flags | LaunchDarkly | building |
| Experiments | Optimizely, VWO | building |
| Surveys | Typeform, Hotjar Surveys | building |
| Calendar and booking | Calendly, Cal.com | building |
| Workflows, the spine and webhooks | Zapier, Make, n8n | live |
| Workflow editor | n8n | building |
| Voice agent | Retell, Vapi | in development |
| Email verification (mailifier probers) | ZeroBounce, NeverBounce | live |
| Cold email: inboxes, sequences, A/B | Instantly, Smartlead | live |
| LinkedIn and Reddit outreach (reach) | HeyReach, Expandi | live |
| Lead research, lead sheet, dossier | Clay, Apollo | live |
| Content planning and posting | Buffer, Hootsuite | live |
| Video editor: cuts, Shorts, thumbnails | Descript, Opus Clip | live |
| The Watch: mail triage | SaneBox | live |
| Books: ledger, subscriptions, invoices | QuickBooks, Xero | live |
| Client portal on the client's domain | GoHighLevel agency plan, white-label portals | live |
| Template library and versions | Instantly and lemlist templates (bundled) | live |
| LLM gateway: key rotation and routing | Portkey, OpenRouter | live |
| credvault: shared credentials, audited | Doppler, 1Password Secrets | live |
| Browser automation (autobrowse) | Browserbase | live |
| Link tracking (`/go/`) | Bitly | live |

The builder checks each row against the code before adding it, and drops or renames any row
that overstates what we built.

## Bookkeeping

Books gets "In-house" beside Subscriptions: each tool, what it replaces, and what that would
cost us a month at our size. A total sits at the top. It's money we didn't spend, not
revenue, and it never enters the ledger.

## In the panel, quietly

- **App launcher and Shop cards:** one muted line under the name, like "In place of Calendly".
  No badge, no price.
- **Shop item page:** an "Instead of" row with the tool, its plan price and the as-of date.
- **Client Account → Billing:** one line, like "Your plan includes 14 tools that cost about
  $X a month bought separately", linking to the list. The number counts only tools the client
  has installed and that are live.
- **Never:** banners, pop-ups, or anything that calls out a competitor by more than its name.

## Rules

- A comparison names only public facts: the vendor's name and its public price, with the date.
- Building or in-development tools never count in a client's total.
- The repo is public: no client usage numbers in the list.

## Build

1. `in-house.ts` with sourced prices, and its test.
2. Books → In-house.
3. Launcher and Shop lines, the Shop item row, the Billing line.

## Decision log

- 2026-10-06: William asked for it. Written; building.
- 2026-10-06: built. `packages/core/src/in-house.ts` (22 tools) and its test; Money → In-house
  (`books.in_house`, team only, total in its head); a quiet "In place of X" under live apps on the
  launcher and under Shop cards (a text column on a Shop card reads as a line under the name);
  "Instead of" on the Shop item page; Billing's line counts the client's installed live tools and
  links to its installed Catalog. Prices read 2026-10-06 from each vendor's own page. Checked
  against the code: "Signals" renamed "Site analytics" (the `research.signals` part is buying
  signals, not site events); Books says spend, subscriptions and unit economics, not a ledger;
  the template library row is
  dropped, as it replaces a feature bundled in Instantly and lemlist, not a tool bought. Dropped
  vendors with no readable price: NeverBounce (page blocked) and Apollo (price loads by script).
  Usage-priced or custom-priced vendors (PostHog, FullStory, LaunchDarkly, Optimizely, VWO,
  Retell, Vapi, ZeroBounce, OpenRouter, n8n in euros) add no number to any total. GoHighLevel's
  page ties white-label to no plan, so the portal row is Starter plus the Branded Client Portal
  app ($97 plus $49 a sub-account). "Costs us" is null where it isn't split out (model calls,
  the prober VPS, SSM and KMS), never a guess.
- 2026-10-06: LLM gateway marked live. Prod WREN_LLM is "gateway" since a279ebb.
