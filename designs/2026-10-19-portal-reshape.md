# Portal reshape: pipeline first in the nav

Living doc. Started 2026-10-19. Follows `2026-10-18-pipeline-first.md` (the model) and `2026-10-18-journeys.md` (built, on main at a194e92d). Inventory of every route: `2026-10-19-portal-inventory.md`. No prices or client names (public repo).

## Goal

Wren's team workspace shows the business in its real order: Offers, Pipelines, Today, People, Numbers. Marketing is the top of every funnel and sits one level down. Tools fold away. Parked apps leave the nav but keep their routes. This is a nav and data-flow change, not the visual redesign (design language is deferred). Every existing page keeps working at its old URL through a redirect.

## Target state (if it cost nothing)

A person opens Wren and sees Today: two lists, Write and Move, nothing else. Write is the content quota for the day, YouTube long-form first, then the platforms in priority order (LinkedIn, Reddit, Instagram, Facebook; X, TikTok, Threads on autopilot). Move is every item that waits on a person and moves a journey, an offer or a funnel: a reply to a lead, an approval, a booked call to prepare, an access or delivery ask. Offers shows each offer with its versions, ICP and terms plans. Pipelines shows one board per funnel, a column per stage, with entries, journeys and signed deals. People is the person graph with groups. Numbers is conversion per stage, per entry, per offer, revenue per entry. Marketing holds the five top-of-funnel tools. Everything else is a tool in a tray or parked.

We build that, except: the visual redesign waits, client workspaces keep their current nav (they get the new shape when the white-label phase starts), and Numbers starts from the `wren numbers` CLI (J5) with the same queries, not a new metrics layer.

## Sidebar, team workspace

Change point: `AREAS` in `apps/portal/web/src/areas.ts`, plus page declarations in `modules/*/index.ts`, plus `moved.ts` for old URLs.

| Area | Apps (sidebar order) | Source today |
|---|---|---|
| (top) | `today` (`/`) | `today.tsx`, rebuilt as Write + Move |
| Primary | `offers` | new module; records `pipeline.offer`, terms plans (new record `pipeline.terms`) |
| | `pipelines` | `deals` renamed: board, journeys, funnels, deals, calls (from `calls`) |
| | `people` | as is, `groups` tab stays |
| | `numbers` | new module over `pipeline.number` (J5) + books revenue slices (`money/economics`, `months`, `channels`, `cohorts`) |
| Marketing | `content` | `marketing` team variant: plan, studio, pieces, drafts, videos, posts, topics, facts, digest, metrics, feed, explore |
| | `engage` | `outreach` renamed + marketing `comments`, `reviews`, `keywords` (comment), `keyword-dms`, `auto-reply`, `approve`, `inbox`, `conversation`, `followers`, `subscribers`, `cadence` |
| | `outbound` | `outbound` + `pipeline` lead sheet (companies, stalls) + `texts` (threads, speed, calls, reviews) + marketing `texts`, `text-copy` |
| | `ads` | `ads` + marketing `ads` |
| | `analytics` | `sites` visitor and search pages (visits, sessions, heatmaps, experiments, surveys, survey-answers, search, keywords, answers, search-days) + marketing `site`, `links`, `funnel` |
| Tools (shut) | `inbox` (mail, done, rules), `workflows`, `loops`, `library`, `marketplace`, `sites` (pages, links, forms, submissions, funnel-map), `calendar`, `money` (spend, models, payments-in, subscriptions, card, in-house, accounts), `payments`, `clients`, `team`, `ask`, `review`, `handlers`, `settings` | as is |
| Account menu | unchanged | |
| Parked | `notes`, `documents`, `learn`, `voice`, `reactivation` | hidden from nav; routes stay; ⌘K still finds them |

Rules kept from `2026-10-10-portal-areas.md`: an id a workspace lacks is skipped, an empty area is not shown, an app no area names lands in Tools. New rule: a module may carry `parked: true`; a parked module is out of the sidebar and the dock, in ⌘K with a "parked" tag, and its pages render as before.

Phone dock: Today, Pipelines, Content → Studio, Engage.

## Today: Write and Move

Two lists, never interleaved. Built from existing sources; no new tables.

**Write.** Today's content quota per platform from the content plan (`marketing.draft`, week view: `modules/marketing/plan.tsx` already computes it). Order: YouTube long-form, then LinkedIn, Reddit, Instagram, Facebook, then the autopilot platforms folded under one row. Each row opens Studio on that draft. A platform with its quota met shows a check and folds. Weak drafts count (standing rule: keep queues full).

**Move.** One query over the things that wait on a person, each with the journey it moves when there is one:

| Source record | Row |
|---|---|
| `pipeline.journey` with a `call_booked` stage and a call inside 24h | Prepare call (opens dossier) |
| `marketing.approval`, `marketing.asked_reply` | Approve or edit, then send |
| `marketing.inbox` (a reply from a person) | Reply |
| `email.reply` | Reply |
| `access.ask`, `delivery.ask` | Answer |
| `pipeline.journey` idle past its stage's `idleDays` (new optional field on a stage) | Nudge or drop |

`waiting.ts` already counts most of these. Move is that list rendered as rows, grouped by journey where one exists, strangers last. One shared `useWaiting()` hook feeds Today, the sidebar badges and the dock, so counts never disagree.

## Offers app

Pages: `offers/all` (list of offers, current version, live plans, open journeys count), `offers/$id` (versions with diff, ICP, plans, funnels that end in it), `offers/terms` (plans across offers; a plan is a terms version with a `plan` name). Edits create versions through the existing `wren offers|terms` paths (version store from J2). Record types: `pipeline.offer` exists; add `pipeline.terms`. Payment terms review comes from William later; the page shows the shape and lets him propose a new version, it does not invent terms.

## Pipelines app

`deals` renamed `pipelines`. Pages: `board` (per funnel; exists), `journeys`, `funnels`, `deals` (signed only), `calls` (from the `calls` app), `entries` (per funnel: kind, channel, count, last arrival). Redirect `/deals/*` → `/pipelines/*`, `/calls/*` → `/pipelines/calls`.

## Numbers app

Pages: `funnels` (conversion per stage, time in stage; from `pipeline.number`), `entries` (journeys and revenue per entry), `offers` (revenue per offer and plan), `months`, `channels`, `cohorts` (moved from `money`). Money keeps spend. A number is a table row, not a chart, until the design language lands.

## Marketing section

Content, Engage, Outbound, Ads, Analytics as the table above. Page declarations move between modules; the components do not change. Each move adds a line to `moved.ts`. The team `marketing` module's duplicate declarations (`keywords`, `reports`, `ads` declared twice; the first wins today) are removed when their pages move. The `More` index page goes; its pages are tabs or link-only in their new app.

## Clients, demo, white-label

Client workspaces keep today's areas and modules in this phase. `AREAS` becomes `AREAS_TEAM` and `AREAS_CLIENT`; `areasOf` picks by audience. The demo follows the client set. When a partner gets the team shape (white-label phase), it is the same `AREAS_TEAM` with components gating the apps, as today.

## Usage per page (the deletion rule)

The portal records no page views. The audit log attributes portal writes to the worker, not to a page. So the usage proxy is 30-day write activity per table (prod, 2026-09-19 to 2026-10-19):

- Active: content drafts and ideas, comments and proofs, reach (LinkedIn), Reddit threads and places, people and profiles, touches, books, delivery, calendar bookings, metrics (post, account, link, scroll, heat days), connectors (automated hourly reads), learn (automated catalog), pipeline (new).
- Dormant (no writes in 30 days): notes, documents (e-sign), voice, reactivation findings, workflows templates, surveys, flags, experiments (last 10-04), sms (4 messages).

Decision: nothing is deleted in this phase. Dormant apps park. The only deletions are the empty `packages/templates` and committed build output (agreed 2026-10-18). A later pass deletes a parked app only after this list is shown again and William says so.

## Shared helpers (never per page)

- `useWaiting()`: the one source for Today's Move, sidebar badges, dock counts.
- `moved.ts`: every old URL in one table, `/old/page` → `/new/page`, query kept.
- `parked` on `Module`: one flag, honoured by sidebar, dock, ⌘K.
- Stories: every new or moved tab has a story (render, play, axe) per `2026-10-18-portal-page-stories.md`. `./scripts/gates.sh ui`.

## Not in this phase

- Visual redesign (design language deferred).
- Client nav reshape and white-label.
- A metrics layer beyond `pipeline.number` and books slices.
- Deleting any parked app's code.
- Payment terms content: William reviews terms later; this phase only shows versions.

## Build

One Opus planner (`implementer`, high). Three builders, at most three at one time:

| Brief | Scope | Depends on |
|---|---|---|
| P1 nav | `AREAS_TEAM`/`AREAS_CLIENT`, `parked` flag, module renames (`deals`→`pipelines`, `outreach`→`engage`, `marketing` team→`content`), page moves between modules, `moved.ts`, duplicate declarations removed, `More` page gone, dock, stories for the sidebar | none |
| P2 apps | `offers` module (+ `pipeline.terms` record), `pipelines` extra pages (`deals`, `calls`, `entries`), `numbers` module over `pipeline.number` + books slices, stories | none (agrees ids with P1: `offers`, `pipelines`, `numbers`) |
| P3 today | `useWaiting()`, Today Write + Move, stage `idleDays`, sidebar badges and dock on the hook, stories | P1 ids |

Hand-off: planner reviews each diff, runs the gate once, reports shas; main pushes. Deletions of `packages/templates` and build output go in P1.

## Decision log

- 2026-10-19: nav order Offers, Pipelines, Today, People, Numbers with Today at the top of the sidebar as `/`. Marketing one level down with five apps. Parked set: notes, documents, learn, voice, reactivation. No deletions beyond the two agreed. Client nav unchanged this phase.
- 2026-10-19 (planner, after reading the code):
  - `/calls/*` is a client app (`calls.outcome`), so it does not redirect. Wren's calls tab is `inbox/calls`; it moves to `pipelines/calls`.
  - `texts` (`sms.*`) is client only and Wren's console does not serve it. Outbound does not take its tabs. Outbound takes the lead sheet (`pipeline` → `outbound`, overview as `sheet`) and marketing `texts`, `text-copy`.
  - `parked` applies to Wren's modules only: `notes`, `learn`, `voice`. `documents` and `reactivation` are client modules, not in Wren's nav; client nav stays, so they do not park.
  - `deals` and `clientDeals` both become id `pipelines`. The client one keeps the name "Journeys" and its area slot. Only the team one gets `deals`, `calls`, `entries`.
  - Team `marketing` becomes `content`; the client module keeps id `marketing`. A move whose old app id a client module also holds (`marketing`, `sites`) applies only at Wren (operator, no `?client=`). Moves of ids no client holds apply to all.
  - `cadence` (posting goals against posts) goes to `content`, not `engage`.
  - Inbox keeps `mail`, `done`, `rules`. `waiting` → `engage/inbox`, `approve` → `engage/approve`, `calls` → `pipelines/calls`.
  - `economics` moves to `numbers` with `months`, `channels`, `cohorts`.
  - The team dock is Today, Pipelines, Studio, Engage. A client dock stays as it is.
  - `packages/templates` is not empty: it holds 45 default files that the CLI build, the Lambda build and deploy read. No build output is committed (`dist/`, `storybook-static/` are ignored). So this phase deletes nothing.
  - Stories: one per visible tab of a new or renamed app. Link-only pages get a unit test that each resolves.
  - `pipelines/entries` is a new record `pipeline.entry` (each live funnel's entries with journey count and last arrival). `offers/terms` proposes a version through a new `termsAdd` console route over the existing `addTerms` store call.
  - Stage `idleDays` sets when a journey reads stale (`STALE_DAYS` stays the default). Move reads the existing `stale` view.
- 2026-10-19 (planner, at merge):
  - Access app ids stay as they are: record `app: "deals"`, `PIPELINE_CONSOLE_APPS["*"] = "deals"`, `APPS` in `@wren/core/access`. They name what a grant covers, and stored grants use them. Portal module ids are nav only. A rename of access ids needs a grant migration; not this phase.
  - The component's `provides.apps` follows the module ids (`pipelines`, `offers`, `numbers`; `content`, `engage`; `analytics`), because `components.test.ts` matches them to modules.
  - Wren's calls page counts calls that start within a day (`soon`), for Today's "Prepare call". A client's Calls app keeps its count.
  - Redirect stories for old addresses are dropped; `moved.test.ts` covers every old address.
  - Move skips `marketing.asked_reply` and `delivery.ask`: no Wren page counts them.
