# Portal page stories

2026-10-18, bead wa-59e. William: "do the msw stuff". Follows designs/2026-10-17-storybook-visual-tests.md.

Whole portal pages and the shell render in Storybook with synthetic data: no backend, no sign-in, no database. A layout or organization change shows on screen in seconds, at 390 and 1280, light and dark.

## Why

- Part stories (`@wren/ui`) tune one part. The overhaul is about how pages and apps are laid out, which needs the shell, the router and the reads together.
- The portal's web talks to the server one way: `POST /api/<service>/<route>` with JSON (`web/src/api.ts`), reads batched through `/api/pulse`. On localhost it sends no token and opens no socket. One fake at the network layer covers the whole app.
- MSW (Mock Service Worker) is the standard fake at that layer: a service worker answers `fetch` in the browser. `msw-storybook-addon` wires it into Storybook. Both free, self-run, maintained.

## Build

1. **Pins.** `msw@2.15.0` (3.0 is three weeks old, with breaking changes) and `msw-storybook-addon@3.0.3` (Storybook 9–11). Exact versions. `mockServiceWorker.js` from `msw init`, committed.
2. **Share the ui Storybook kit, written once.** `@wren/ui` exports its preview (frame, theme, viewports), its Vitest story-test config as a function, and its setup file. `run.mjs` (checks lock, one Chromium, one look at a time) and `serve.mjs` (one Storybook per port, reuse a running one) work from the calling package and take a port. They become `@wren/ui` bins: `wren-stories`, `wren-storybook`.
3. **Portal Storybook.** `apps/portal/.storybook/`: stories `web/src/**/*.stories.tsx`, the ui preview plus the MSW loader, `staticDirs` for the worker. Port 61001 (ui stays 61000). Scripts: `storybook`, `stories:build`, `test:stories`.
4. **A router per story.** `router.tsx` exports `createPortalRouter(history)`; the app's router is one call of it. A page story makes one on a memory history at its address (`/leads/pipeline?view=all`) and binds it.
5. **Fake API.** `web/src/mocks/`: one handler for `POST /api/*` that answers from a table, path → typed answer; `pulse` answers each call from the same table. A path not in the table, writes included, answers 404 and logs `unmocked: <path>`. Answers are typed with the server's own API objects (`serve<Api>`), so a server change breaks the typecheck, not the story.
6. **Fixtures.** `web/src/mocks/data/`: synthetic only (the repo is public). One workspace with every app. Records pages get generic types made from each page's columns and `count`/`needs` states, rows by field kind, through `pageOf` from `@wren/ui/fixtures`. A record the code reads as its own type (`marketing.cadence`) gets hand-written rows.
7. **Stories.** `web/src/pages-client.stories.tsx` (each client app's first page as its owner, a record open, `Loading`, `Failed`) and `pages-wren.stories.tsx` (each of Wren's apps as its admin). A story swaps an answer with `pageAt(at, { answers })`.
8. **Tests and gates.** Portal `test:stories` runs the page stories as tests, under the lock. Each story's `play` waits until the fake server is quiet, then fails on any unmocked call; axe then reads the page with its data in. `gates.sh visual` runs `test:stories` for every package that has it, one at a time (`--concurrency=1`). CI's stories job does the same.
9. **Docs.** `wren-ui` skill: the page loop. Map `ui` hub: a page-story card.

## Done

- `pnpm --filter @wren/portal storybook` shows the shell and pages on 61001 with no server running.
- An unmocked path is named in the console.
- `test:stories` passes for ui and portal, locally under the lock and in CI.

## Found on the way

- The phone tab bar gave Home's tab and an app's own `home` page (Notes) one id: both lit, and Notes' tab opened Home's stack. Home's tab inside an app is now `HOME_TAB`.
- The calendar's hours scroll box took no keyboard focus (axe `scrollable-region-focusable`).
- When every read fails, Today says "Nothing waits on you." A failed read reads as empty. Left for the overhaul.

## Follow-ups

- Real record types in the stories: each product's records list lives in its server (`apps/worker/src/services.ts`, `apps/portal/scripts/preview.ts`). One shared list both serve from would let the fake answer the server's own types.

## Decision log

- MSW at the network layer over faking `call()` in code: the app runs unchanged, batching and the write path included.
- A second Storybook in the portal over one in `@wren/ui`: ui must not import the app. Shared pieces export from ui, so nothing is copied.
- `nodeStubs` in the portal Storybook: the app imports server modules (a `createHash` in core) that Vite's dev server refuses at load; the build only fails on a call. The stub does what the build does.
- Generic record types over copying the server's: a copy drifts; generic types show the page's frame, which is what the overhaul tunes.
- An unmocked call fails the test, not only warns: a page that starts a new read gets its answer the same day.
- msw 2.15 over 3.0: 3.0 shipped 2026-09-28 with breaking changes; 2.15 is the mature line the addon also supports.
