# Flags, experiments, surveys, heatmaps (2026-10-06)

William, 10-06, on the four PostHog features that signals (`2026-10-06-signals.md`) left out:
"those are all extremely useful yes". All four are built by us, on the stack we have, at $0.

## Answer first

- **Heatmaps:** the lander logs clicks by a stable element path, plus scroll depth. wren
  stores daily counts. Marketing → Heatmaps draws them over a rebuilt replay snapshot of the
  page.
- **Flags:** one `flags` table. A flag has variants (on/off is two) and rules: everyone,
  roles, clients, people, a percent, and a kill switch. The portal gets them in the session.
  The lander gets them from an edge config that wren pushes.
- **Experiments:** a flag with a goal. The lander picks the variant at the edge, so there's no
  flicker. Outcomes are counted per variant, and `@wren/experiments` (the email bandit)
  decides shares. William starts an experiment and ships its winner.
- **Surveys:** one question at a time, on the lander or in the portal, triggered by a page, a
  delay or an event. Site answers stay on the lander; wren keeps tallies. Portal answers are
  stored in wren.

## 1. Heatmaps

- **Lander `hit.ts`:**
  - `click`: path (stable CSS path, at most 8 levels, preferring `id` and `data-signal`), fx
    and fy (where in the element, 0 to 1), and a width bucket (phone, tablet, laptop, wide).
    At most 50 per view.
  - `scroll`: the deepest point reached in percent, plus page height, sent when the page is
    hidden.
  - `rage`: 3 or more clicks on one element within a second.
  - Same consent as other events. They go into the existing `events` table and export.
- **wren rollup:** `heat_days` (day, page, bucket, path, clicks, rage) and `scroll_days` (day,
  page, bucket, 10% band, views). Counts only, no visitor ids.
- **Portal (Marketing → Heatmaps):**
  - Pick a page, a width and 7 or 30 days.
  - The framed `/replay` page rebuilds the newest replay snapshot of that page at that width.
    It finds each path in the rebuilt page and draws the click density.
  - The scroll map shades bands by how many visitors reached them. Rage clicks are marked.
  - With no snapshot at that width, it says so.
- Why not clicks from the replays alone? rrweb node ids differ per visit, so clicks can't be
  lined up across visitors. Replays supply the picture; events supply the counts.

## 2. Flags

- **`flags`:** key, about, variants (default `off`, `on`), rules (ordered; first match wins:
  roles, client ids, person ids, percent by a hash of the person or visitor), a default,
  `killed`, and `surface` (portal, site, both).
- A record declares edits (`2026-10-06-edits-claude-templates.md` step 1), so History, Undo
  and Ask Claude come free. Every change is audited. The page is Loops → Flags, for the
  team only.
- **Portal:** the worker evaluates flags per request and puts the results in the session.
  `useFlag(key)` reads them, and server handlers check the same evaluation. The ad hoc "In
  development" gates move onto flags: operators see everything, clients see released apps.
- **Edge config:** wren posts flags, experiment shares and surveys to the lander
  (`POST /api/edge`, a bearer `EDGE_TOKEN` in Pages secrets and SSM). D1 keeps one row, and
  an isolate caches it for 60 seconds. It's posted on every change and on each rollup pass.

## 3. Experiments

- **Authoring:** the variants are markup in the lander:
  `<div data-flag="hero" data-variant="b">`. Copy follows the lander rules. Variants ship
  through a lander push, like any copy.
- **Assignment:** a new `functions/_middleware.ts` runs HTMLRewriter on pages that carry
  `data-flag`. It removes the variants the visitor isn't in, before the page leaves the edge:
  no flicker, and the page stays static.
  - Sticky by a hash of the `wv` visitor id and the flag key.
  - Pages with experiments go out `Cache-Control: private`.
  - Without the cookie yes, the visitor gets a random variant and isn't counted.
- **Exposure:** `exp.seen` (flag, variant) fires when the variant renders.
- **Outcome:** `flag_days` (day, flag, variant, channel, visitors, forms, calls, paid), joined
  by visitor in the existing site rollup, the way `site_days` is.
- **Decision:** the rollup feeds `flag_days` to `@wren/experiments` (Thompson by default),
  pushes the new shares to the edge, and stops at convergence.
  - Starting an experiment and shipping its winner are buttons for William.
  - Ship sets the flag to the winner at 100%. Removing the losing markup is a later lander
    commit.
- **Portal (Marketing → Experiments):** each one shows its variants, shares, P(best), the
  funnel per variant and its state.

## 4. Surveys

- **`surveys`:** a question; a kind (choice, scale 1-10, short text); choices; where (site or
  portal); a trigger (page plus delay, exit intent, after `form.submit`, `book.click`, or the
  booking confirmation); an audience (channel, flag variant, client); and caps.
- **Caps:** once per visitor per survey, at most one survey per visit, and never on a form
  page before its submit.
- **Lander:**
  - A small card with square buttons and one-at-a-time motion, dismissable.
  - Answers go in D1 `answers` (survey, visitor, view, page, value) and through
    `/api/export?table=answers`.
  - wren stores daily tallies per choice and channel; text answers are read live, like
    sessions.
- **Portal:** the same card in the app for client users (for example, a score after a month).
  Answers are stored in wren (`survey_answers`), under the tenant.
- **Portal (Marketing → Surveys):** each survey's tallies over time and the newest answers.

## Rules

- No spend. D1, S3 and Workers stay inside today's plans.
- Consent: clicks, scroll, exposures and answers follow the cookie yes. The privacy page gets
  one line on clicks and surveys.
- A survey or an experiment going live on the public site is William's yes. Shares moving
  inside a running experiment don't need one.
- The repo is public: tests use synthetic pages and visitors.

## Build order

1. Heatmaps.
2. Flags, the portal side and the edge config.
3. Experiments.
4. Surveys.

## Decision log

- 2026-10-06: William approved all four. Written and building.
- 2026-10-06, heatmaps built:
  - `heat_days` also keys a `cell` (a 10 by 10 grid inside the element, `row*10+col`), so the
    map shows where in a big element clicks land. `rage` carries the same position.
  - `scroll` reports reach (bottom of the screen over page height), not `hits.depth`, which
    can't be turned into bands.
  - A click a label passes on to its input counts once; a click with no pointer (a key press)
    is skipped.
  - SearchWatch reads events after a cursor (`heat from`), recomputes every day it read in full
    and replaces those days. The cursor stops before the newest day, which may still be
    arriving.
  - The page is a list over `marketing.heat` (window, width, page). Opening a row returns the
    counts plus the signed first chunk of the newest replay at that width. No hand-built page.
  - The frame plays that chunk to its end, shows reveal sections at rest, and draws the overlay
    in its own document over the scaled page: nothing appended inside the rebuilt page paints.
    Shrunk to fit, never enlarged. Clicks on paths the page no longer has are counted and
    named under the map.
- 2026-10-06, flags built:
  - Rules are words, one per line: `variant: condition; condition`, with roles, clients,
    people, `n%` or everyone. First match wins. History, Undo and Ask Claude read the same text.
  - A percent uses one bucket per flag (FNV-1a of `key:id`), so `b: 20%` then `c: 50%` gives c
    30%. The lander keeps a copy of the hash and the evaluation.
  - Changing a flag needs `manage` at Wren. The team passes an `Access.flag` gate only when its
    variant isn't `off`.
  - `me` carries each login's portal variants per client and for the team. The demo gets none.
    The web reads them from a module store (`useFlag`), not a context provider, to keep App.tsx
    unwrapped.
  - Site flags go to the lander whole on every site change (`POST /api/edge`, bearer
    `WREN_SITE_EDGE_TOKEN`) and again on each SearchWatch pass. The push runs inside the edit's
    transaction: on a rare rollback the edge is one change ahead until the next pass. A failed
    push is logged and never fails the change. No token, no push.
