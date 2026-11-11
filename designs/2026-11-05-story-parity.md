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

`apps/portal/web/src/stories-cover.test.ts` lists every page of `TEAM_PLACES`, `CLIENT_PLACES` and Research, and fails on each one with no story address. Client stories live in `stories/client/` (was `pages-client*` and `pages-account*`, until WA-1160). A bare place address (`/project`) covers the place's first page.

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
- Decided 11-05 (William): the phone bar holds 4 places (`BAR_SIZE` 4, `packages/ui/src/phone-nav.ts`), so every place in `DOCKED` docks: Home, Today, Campaigns, Research, People, Apps. Six tabs, one more than iOS's five. Was: 3 slots, People never docked.
- Decided 11-05 (William), `@wren/ui` parts no page uses: keep BusyBox, LinesChart and MoneyField for a later page. Keep AccountField; its look is open (an account picker will be needed, this may not be the right one). RadioField (the Tone choices in the Edit form story) is deleted. The edit form itself stays: twelve pages use it.
- Agent fixtures: `thread.test.ts` plays the recorded tapes (`mocks/data/agent/work|stop|history.json`), the same ones the stories play. `modules/agent/fixtures/` is gone. `scrub-tape.mjs` cuts a loaded skill's body to 2000 characters: work.json 153 → 134 KB.
- 11-05, drift check after the system changes:
  - `stories-cover.test.ts` passes: no page lacks a story. The only module changed since the pass above is Variants; it has its page story and answers.
  - Full run: `@wren/ui` all pass; portal 185 of 188. The three failures were Research. Tree and Web all timed out on a 1 s find while the Mac was loaded (now 8 s). Web all and Web picked failed axe at `dark-1280`: the web page's side column was a second unnamed `<aside>` beside the shell's (now named "Search and details").
  - Gap: the shell's player had no story since Learn was cut, and no story drew a recording's video, notes and transcript. New `pages-player.stories.tsx` (`Wren/Player`) on `/today/recordings/1`: over the slot, docked, and after a move.
  - Bug the player story found, fixed: a slot's way back was the window's address, so on a memory history Expand opened the wrong page. It now takes the router's address (`here`, `route.ts`). No change on the browser's history.
  - Docs that drifted, fixed: the map's UI hub (`map/objects/ui/CONTEXT.md`: places, today's parts and line numbers, a table of the page story files, the Map section), its `story`, `page-story` and `player` cards, and the `wren-ui` skill's page loop (story ids and files).
- 11-07, drift audit (WA-1170): page stories render the real app, so drift lives in part stories (`packages/ui`) that pass props a portal call site never passes. Found and fixed:
  - Research source card: its ask buttons never showed in prod. The chat card now passes the channel's ask ("Research the whole channel") and sends a pick as the person's own turn (`AgentSay`).
  - Map skeleton: Focus and the home view's wait drew no ghost of the page's plates. Both now pass `ghost`, keyed as Focus keys it.
  - Agent clip and Variants video: the part's own `Video` bar (WA-1172) replaces native controls in both.
- Left, by choice: MetroMap `bare` (no dot grid) and the Map's draw-in `intro` are off in prod on purpose (MapPage doc; the ghost takes the intro's place).
- Left, open: a research topic ask ("Research how … set prices") needs the agent's own suggestion; nothing makes one yet. Graph `ribbons` and the `Steps` long-job part have no page. Player `FileMedia` keeps native controls. Minor props no page sets: AgentThread `closed`, Rows `pick` on Today and Studio waiting, DataTable `framed`, AccountPicker unsaved.
- 11-07, drift run-by with William (WA-1173 to WA-1176). His picks: Birdwatch writes topic asks (WA-1175); the chat locks with its reason (WA-1173); bulk pick on Studio waiting only (WA-1174). The rest was the session's call: keep a part that is a real extension or edge case, else cut.
  - Chat lock (WA-1173, done): a fault that can never pass in this chat (no access, someone else's chat, credential stop, setup or chat gone) locks the box with its sentence; prompts and attach hide. A relay that is down was already handled: the panel shows its alert in place of the chat. Found on the way: after `/clear` the new session's empty history (404) showed "chat gone"; fixed.
  - Steps (kept): the artifact's "Long job" (section 14); no page has a staged job outside the chat yet (import, render, send are the first callers). Its hold (`useHeldLine`, 600 ms; `useHeld` is the undo hold in action.tsx) now also runs the chat's working line, so fast tool calls never flicker it.
  - Graph `ribbons` (kept): the Map's volume view later (width = people who crossed). Built and tested; the Map runs on Orrery now, so no page to wire today.
  - DataTable `framed` (kept): the artifact's `.tw` table (#diff), for the first compare page.
  - AccountPicker `unsaved`: not drift. The draft and the edit form pass it; the audit read only the thread reply.
  - Player `FileMedia` (kept native): the Player also plays YouTube and post embeds in their own controls, docks in a corner and opens Picture-in-Picture; the Video bar sits under the frame and needs height the slot does not have. One look inside the Player beats the kit's bar on files only.

- 11-11, WA-1101: an Empty pass (`empty-1280`, `run.mjs --empty`) runs every page-story file once more with no records. `pageAt` then checks the empty state teaches (ui-design SV-8): `[data-empty]` shows, its line says what fills it, and one state gives the action that fills it, unless all are `Empty waits` (someone else fills it). First run: 134 of 246 failed; now 246 pass.
  - The pass wins over a story's `data: "tidy"`: story-tests.ts defines `STORY_PASS_DATA`, and the portal decorator reads it. The play reads the fake server's look (`dataLook()`), not its own globals.
  - `empty: false` skips the check where a story holds no list: one record (a batch, a tree, a person, a recording), a form or setting, a document, a calendar, a dashboard, the Map (`mapAt`), the side chat, and Weaver runs (weaver serve answers, not the fake server).
  - Fixed on the way: records-list's empty view is an `Empty` (Clear filters, else Elsewhere, else `AskAgent`); not-installed parts, Spend by month, Agenda and Today's quiet lines are `Empty waits`; Vireo's no-match line has Clear filters; the `Pieces.list` mock was stale (`PieceList.list`).
- 11-11, WA-1101 part 2: the portal's stories sit under `App/` (main.ts `titlePrefix`), first in the sidebar, then the kit's Templates, Components and Lab. Storybook reads `storySort` statically, so the portal copies the kit's order (no import). Each group opens on an Intro story. Portal story ids gain `app-` (`app-wren-map-layers--floor`).
