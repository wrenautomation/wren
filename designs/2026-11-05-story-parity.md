# Story parity: the story is the floor

2026-11-05. William, 11-04: "the storybook should usually not look better than the real UI, only worse. The storybook is the initial draft that looks very good, and the real UI is a more polished version that handles issues, real data and edge cases even better."

The agent chat already works this way (`2026-11-04-multi-user-runtime.md`, Decision 14). This doc takes the rule to every portal page.

## Why a story looks better than live

1. Other code. A part story builds the part alone. The page wires it, and can drop a prop, a state or a feature. The story keeps it.
2. Clean data. Hand data is short and on the happy path. Live data is long, empty, late or failed.
3. Old deploys. A red main left prod behind the stories (fixed 11-04: CI is green).

## Target

- Every page a person can open has a page story (`pageAt`). It renders the real page through the real router, so code drift is impossible on that page.
- The shared fake server (`mocks/data/index.ts`) answers with data at least as hard as prod: long names and text, non-Latin, huge and zero counts, missing fields. One table, so each new page story gets hard data free.
- Each page has its hard states: data, empty, pending, failed read. Pages that list rows also hold the words-in-boxes check (`pageAt` `check`).
- Each page story checks its features with `check`: the heading, its main actions, its tabs. A page that drops one fails.
- Part stories in `@wren/ui` stay the draft. They are never the only story of a screen.
- One source per fixture: the agent's unit tests read the recorded tapes, not a second hand set.

## Options

| Option | Drift caught | Cost | Against |
|---|---|---|---|
| A. Page story per page on one shared hard table; a test fails on any page without one | code: all; data: as hard as the table | one line per page, data once | the table needs care when an API changes |
| B. Hand messy answers per story | same code; data per story | high, repeats | the drift returns where nobody wrote a hard case |
| C. Scrubbed prod snapshots | real data | a scrub per table | client data in a public repo: out |
| D. Seeded random data (faker) | wide | a new library | a failure is hard to read; the worst cases already sit in `@wren/ui/fixtures` `WORST` |

Ranked: no code drift by construction, then public-repo safety, then upkeep. Chosen: A. B stays for a page-specific case. C is out. D adds little over `WORST` and `mocks/data/long.ts`.

## Guard

`apps/portal/web/src/stories-cover.test.ts` lists every page of `TEAM_PLACES`, `CLIENT_PLACES` and Research, and fails on each one with no story address. Client stories live in `pages-client*` and `pages-account*`. A bare place address (`/project`) covers the place's first page.

It is a Vitest test, not a `scripts/*-guard.mjs`: the place list is built by importing the page modules, which plain node cannot load. During the redesign unit tests report and do not hold the deploy (WA-917). That is the trade-off: it shows red, it does not block.

## Done

1. `stories-cover.test.ts` passes: every team and client page has a page story.
2. Each page story passes at `dark-1280` and `light-390` with no unmocked read.
3. Each new story has a `check` that finds the page's heading and main actions.
4. The shared table holds the `WORST` values in the lists pages read first.
5. The agent unit tests read `mocks/data/agent/*.json`; `modules/agent/fixtures/` is gone.
6. Fixtures stay small: each JSON under 150 KB; tapes and scratch files deleted from the Mac after use.
7. Failing stories found on the way are fixed or logged here with why.

## Log

- 11-05, before: 18 team pages and 36 client pages had no story. Some stories tested the wrong page and passed: the fake client had no Project or Campaigns place, and Money landed on home. `pageAt` now fails on that (`lands`).
- 11-05, after: `stories-cover.test.ts` green (team, client, no moved address). Portal stories: 185 at `dark-1280` and 185 at `light-390`, all pass on Messy data.
- Bugs the new stories found, fixed:
  - Prod: a cold load of a bare place (`/office`, `/today`, `/campaigns`, `/people`) sent a team member home. `place()` took the client place's first page before the viewer loaded. It now waits for the viewer.
  - Prod: six record panels crashed ("This page hit a problem") on a type with no detail read: reactivation email, person, reply; work update, ask, deliverable. They now add nothing until the detail lands.
  - a11y: the timeline's disabled "Day after" was an `<a>` with no href and an aria attribute (role link now). The Experiments mock drew a second nav landmark (now a div).
- Stale stories removed: Client health (cut from the app) and its rows data; Journeys (moved). Story groups now name the audience and place (Wren/…, Client/…), not a build status. Moved addresses fail the cover test.
- Messy is the Storybook default (decision): every page story runs on long, non-Latin text unless it pins `tidy` (`mocks/page.tsx`). Tidy is only for checks that read a hand-made word (a name, a file name). Ten stories and the Map file pin it.
- States per template: pending and failed read are tested once per page template (team: Spend; client: Project plan), not per page. Every page shares `pageAt`'s loading and error path, so one story per template catches drift there.
- Phone checks: on a phone a queue shows the list alone. `shows()` taps the open row before it looks for actions, as a person does. On a phone the Videos item puts Render in the thumb bar's overflow, so the check uses Approve.
- Open, not fixed: the phone bar holds 3 places (`BAR_SIZE`, `packages/ui/src/phone-nav.ts`), but `DOCKED` in `areas.ts` lists 4. People never docks. A design call for William: 4 slots, or drop People from `DOCKED`.
- Open, not deleted: `@wren/ui` parts no app or part uses: BusyBox, LinesChart, MoneyField, RadioField, AccountField. Their stories still show live parts, so they are not stale stories. Delete them when the redesign says they are gone.
- Agent fixtures: `thread.test.ts` plays the recorded tapes (`mocks/data/agent/work|stop|history.json`), the same ones the stories play. `modules/agent/fixtures/` is gone. `scrub-tape.mjs` cuts a loaded skill's body to 2000 characters: work.json 153 → 134 KB.
