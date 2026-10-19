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

## Nav, later

Offers, Pipelines, Today, People, Numbers. The big UI redesign waits (design language deferred). The model lands first; the portal reshapes after.

## Client zero

Wren runs on these objects from day one: one offer, three funnels (organic content → audit call, one entry per platform, holistic top of funnel in priority order YouTube, LinkedIn, Reddit, Instagram, Facebook; LinkedIn DMs → audit call; ads → audit call, off until needed), the partners' journeys, each partner's deal and terms version. If a step needs a manual action from William that is not writing or a sales call, it is a bug.

## Spawned designs

- (pending) domain model: offers, terms, funnels, journeys, deals on the spine.
