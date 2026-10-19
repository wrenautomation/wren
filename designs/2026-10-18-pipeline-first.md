# Pipeline first

Living doc. Started 2026-10-18 from the direction talk with William. Vision only; the detailed designs it spawns are listed at the bottom. No prices or client names here (public repo).

## The problem

Wren is built channel first: Marketing, Inbox, People, Content are tools. A business is Offer → Funnel → Journey → Delivery → Upsell. William's job is to shape offers and funnels and write; wren's job is every other step, and to change shape as the business moves from stage to stage (0 → 10k → 30k → 100k/mo). The nav and the data model should say that.

## The objects

**Offer.** What is sold, to whom, on what terms. Versioned. One offer, many funnels. An offer can be the end of one funnel and the entry of another (a webinar is sold, and its buyers enter the high-ticket funnel). Composition is explicit: a funnel's completion feeds another funnel's entry. An offer never has several "types".

**Terms.** Payment is part of the offer: setup, share, floor, plans, installments, trials. Versioned. A deal pins the version it was signed on. A change makes a new version with an effective date, never an edit in place. Payment events (invoiced, paid, late, refunded) are journey events.

**Funnel.** An ordered list of stages that ends in an offer, with one or more entries (ads, organic LinkedIn, referral, a prior funnel's completion). Versioned, append only. Add a stage at the bottom later (the upsell) and existing journeys keep their position. Stages can be skipped: a transition is an event from any stage to any later stage, and the skip is recorded.

**Journey.** One person in one funnel version: current stage, every transition with its cause (a post, a DM, a booked call, a payment), and attribution to the entry. The state machine is per funnel version. One person may hold several journeys.

**Deal.** Person × offer × terms version, with the payment schedule it implies and what was collected. Today's `@wren/deals` pipeline (stages, won, lost) becomes the "closed" slice of a journey, not a separate pipeline.

**Today.** The one list. It shows only work that moves a journey, an offer or a funnel forward. Everything else is automated or deleted.

**Numbers.** Per funnel stage, per offer, per entry, with cost. Conversion between stages, time in stage, revenue per entry.

## What exists and must be reused

- `packages/offers`: the typed offer contract (catalog, lander export). Grows terms and versions; stays the one source.
- `packages/deals`: pipeline stages per owner. Folds into journeys.
- `packages/payments`, `packages/books`, Wise billing: payment events.
- `packages/core/src/spine.ts`: events on routed wires, every arrival a row. Journeys ride the spine; they do not get a second event system.
- People, touches, person timeline: a journey transition cites the touch that caused it.
- Content, comments, DMs, email, text: steps inside a funnel stage, not top-level apps.

Framework rule applies: before any custom state machine code, the planner vets XState (statecharts, versioned machines) against the spine and says which fits where.

## Leads, ICP and enrichment

Three things, no section of their own (agreed 2026-10-18):

- **ICP** is part of the offer version: who, firmographics, qualifying and disqualifying signals. New ICP, new offer version. Funnels inherit it.
- **Sourcing** (scraping, lists, Exa, job boards, signals) is a funnel entry of kind `sourced`. It fills the first stage of an outbound funnel with people who match the offer's ICP. Lives under Marketing → Outbound. `research` and discovery stay as they are and gain an entry config.
- **Enrichment** (dossier, cross-platform search, Jev's lead verdict) is a stage step, not a stage. It runs on arrival, writes to the person, and may move or drop the journey. Each stage has a research depth: none, light, full. Examples: comment arrives → enrich → verdict → open journey or ignore; call booked → dossier → call prep in Today's Move list.

## Groups (segments)

A group is a saved query over people and their journeys (stage, entry, offer, tags, enrichment facts), kept live. It is not a section. It is used in three places: as a funnel entry of kind `group` (members enter a funnel, the way a prior funnel's completion does), as the audience of content or a DM sequence, and as a filter on People and Numbers. Today's People "groups" become this.

## Nav, later

Agreed 2026-10-18. The big UI redesign waits (design language deferred). The model lands first; the portal reshapes after.

- Primary: **Offers, Pipelines, Today, People, Numbers.**
- Today has two lists: **Write** (the content quota, William's creative block, YouTube long-form first) and **Move** (journey work, approvals, replies). Never interleaved.
- Auxiliary section **Marketing**, the top of every funnel: Content (plan, write, drafts, videos, studio, posted, per-platform numbers; every platform stays, none parks), Engage (comments, replies, DMs, invites, places, karma, accounts), Outbound (cold email, inboxes, signals, text: kept), Ads, Analytics (visits, sessions, heatmaps, experiments, surveys, search). Numbers is per funnel stage and offer; Analytics is site telemetry. They stay apart.
- Tools tray: workflows, loops, marketplace, library, sites, calendar, money, team, account.
- Parked (code stays, hidden from Wren's nav): notes, documents, connectors, learn, voice, reactivation. Each can return as a funnel part or an offer of its own (reactivation is an offer; a voice agent is a stage's cause). That is the extension rule: anything new is either an entry, a stage cause, a step, or an offer.
- Deletions only after a usage list per page is shown. Exceptions: the empty `packages/templates`, committed build output.

## Client zero

Wren runs on these objects from day one: one offer, three funnels (organic content → audit call, one entry per platform, holistic top of funnel in priority order YouTube, LinkedIn, Reddit, Instagram, Facebook; LinkedIn DMs → audit call; ads → audit call, off until needed), the partners' journeys, each partner's deal and terms version. If a step needs a manual action from William that is not writing or a sales call, it is a bug.

## Spawned designs

- `2026-10-18-journeys.md`: offers, terms, funnels, journeys, deals on the spine. Beads under wa-8pi (J1-J7).
