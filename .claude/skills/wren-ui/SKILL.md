---
name: wren-ui
description: Change how a portal screen or a @wren/ui part looks or lays out, and check it in a Storybook story before the portal. Use for UI tuning, a layout bug, a new state of a part, or a new part. For where a page lives in the portal (William's navigation), use the `portal` skill.
---

# Tuning the portal's UI

The look's rules are `DESIGN.md` (repo root). The route from a screen to its part and story is the map's UI hub, `map/objects/ui/CONTEXT.md`. Where a page sits for William: the `portal` skill.

Reuse the running Storybook and stop it when done. Run heavy checks only through `./scripts/gates.sh`.

## Loop

1. Read the `DESIGN.md` section for the part (Colors, Typography, Layout, Components → Buttons, Lists and records, Tables, Cards, Navigation and shell, Phone, Charts, Motion).
2. Find the part and its story ids in `map/objects/ui/CONTEXT.md`. A `template` page is drawn by its template; tune the template.
3. Start Storybook in the background: `pnpm --filter @wren/ui storybook`. It serves http://localhost:61000. If one already runs there, it says so and exits: use that one.
4. Open one story: `http://localhost:61000/?path=/story/<stem>--<state>`, for example `records--worst-case`. No chrome: `/iframe.html?id=<id>&viewMode=story`. Night look: add `&globals=theme:dark`, or use the toolbar.
5. Edit the part in `packages/ui/src/`. Storybook reloads it.
6. Screenshot what you changed, phone and desktop, both looks:
   `pnpm --filter @wren/ui stories:shot --width 390 --dark records--worst-case shell--default`
   It writes PNGs to `<tmp>/wren-ui-shots/` and exits 1 on a page error, a console error or a failed `play`. Read the PNGs.
7. Test the file you changed: `cd packages/ui && pnpm exec vitest run src/<file>.test.tsx`.
8. Check before commit: `./scripts/gates.sh ui`. Biome on changed files, typecheck of ui + portal, the portal's source guards, related tests, then the story tests (`visual`).
9. Stop Storybook: Ctrl-C, or `pkill -f .storybook/serve.mjs`. Then `lsof -i :61000` shows nothing.

Run the full gate (`./scripts/gates.sh all`) once, at hand-off. Not in the loop.

## Page loop

For a whole page, the shell, or how apps and pages are laid out. The real app runs on a fake server: no backend, no sign-in.

1. Start it in the background: `pnpm --filter @wren/portal storybook`. It serves http://localhost:61001.
2. Open a page: `pages-client--<app>` (a client's owner) or `pages-wren--<app>` (Wren's team), for example `/?path=/story/pages-client--reactivation`. Links move inside the story.
3. Edit the page or part. Storybook reloads it.
4. Screenshot: `pnpm --filter @wren/portal stories:shot --width 390 --dark pages-client--people`.
5. A new page story: `export const X = pageAt("/app/page?view=all")` in `apps/portal/web/src/pages-client.stories.tsx` (or `pages-wren.stories.tsx` with `{ me: ADMIN }`). States: `{ mode: "pending" }`, `{ mode: "fails" }`. One answer swapped: `{ answers: { "<service>/<route>": body } }`.
6. The console says `unmocked: <service>/<route>` for a read with no answer. Its test fails too. Add the answer in `apps/portal/web/src/mocks/data/`, typed with `serve<Api>(service, {...})` where the server exports its API type. Synthetic data only.
7. Test: `pnpm --filter @wren/portal test:stories` (under the lock, about 30 s). Then `./scripts/gates.sh ui`.
8. Stop it: `pkill -f "serve.mjs 61001"`. Then `lsof -i :61001` shows nothing.

Records pages get generic types, made from each page's columns and states. A column the server adds shows only in the portal preview.

## Stories

- A story file sits beside its part: `packages/ui/src/<stem>.stories.tsx`, in CSF (`Meta`, `StoryObj` from `@storybook/react-vite`). Id = `<stem>--<export>` in kebab case.
- Each set exports `Default`, `Empty`, `Loading`, `Failed`, `WorstCase`. Add a named state when a part has one (`PanelOpen`, `Bulk`).
- Data comes from `packages/ui/src/fixtures/`, never inline in a story. A read's states: `answer`, `pending`, `fails` (`load.ts`). Long text and huge numbers: `WORST` (`worst.ts`). An address: `fakePlace`, or `usePlace` for a live one (`place.ts`). Records: `fakeRecords`, `useRecordsDemo` (`records.ts`).
- Fixtures are synthetic only. The repo is public: no real names, leads, amounts or clients.
- Unit tests import the same fixtures. A new fixture goes in the domain file, or a new one, and `fixtures/index.ts`.
- `parameters: { layout: "fullscreen" }` drops the 24px padding for a full-frame part (shell, records page).
- A story that shows an interaction does it in `play` (`storybook/test`: `userEvent`, `expect`, `fn`), not with a prop that fakes the end state.
- Widths: phone 390, tablet 820, desktop 1280 (the viewport toolbar, or `--width`).
- Long text never widens a page. `Button`, `Tag`, tab names and the workspace chip end in "…". A grid of parts gets `grid-cols-1` (or its items `min-w-0`). A count in a badge uses `short()` ("1.2B"); its hover keeps `num()`.

## Story tests

- `./scripts/gates.sh visual` runs every story as a test: it renders, its `play` runs, axe checks it. Light at 390, dark at 1280, one at a time, under the checks lock. About 20 s, peak 1.6 GB.
- No screenshot compare (off since 10-18): the look is yours to read with `stories:shot`, not a baseline's.
- An axe failure fails the story. A known gap gets `parameters: { a11y: { test: "todo" } }` with a one-line comment that says why. Fix the gap instead when it is small.
- `./scripts/gates.sh lint` builds every story (`stories:build`). A part's prop change that breaks a story fails there.

## When to leave the story

- **`/impeccable live`**: the look depends on real data, past what the page story's fake data shows. Start the portal on your machine (`pnpm --filter @wren/portal preview`) and pick the element there. The preview is a build, not hot reload: run it again to see an accepted change.
- **An HTML playground**: a new direction before any build, to compare looks fast. Throw it away after. Never keep it beside a part: it copies the code and drifts.
- **Never** shoot or scan prod (`app.wrenautomation.com`): it spends the portal Worker's free request cap.

## Done

- Screens shot at 390 and 1280, light and dark, read by you.
- `gates.sh ui` passes, story tests included. `DESIGN.md` changes in the same commit when a token or a rule moves.
- Both Storybooks (61000, 61001) and any browser stopped.
