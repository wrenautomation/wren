---
type: object
cluster: ui
universe: live
status: verified
verified: 2026-11-05 @ 8f09445ec
entity: apps/portal/web/src/mocks/page.tsx:1
---

# page-story

A whole portal page in Storybook: the real app (router, shell, data layer, batching) at one address, on a fake server (MSW). `pnpm storybook` serves it on :61000, in one sidebar with the ui parts, and each story runs as a test. Every page a person can open has one (`designs/2026-11-05-story-parity.md`); the ids are in the hub's Page stories table (`objects/ui/CONTEXT.md`).

## Why this shape

Layout and organization changes need the shell, the router and the reads together, which a part story lacks. Faking at the network (`POST /api/*`) leaves the app unchanged, so a page story cannot drift from the page.

## Shape

- Config: `apps/portal/.storybook/main.ts` (stories `web/src/**/*.stories.tsx`, plus the ui parts' stories when `serve.mjs` starts it (`WREN_STORYBOOK=serve`; tests and builds keep each package's own), addons a11y + vitest + msw, `nodeStubs` for server modules the app imports, `dictateOff` for the one GET made at load), `preview.tsx` (ui's frame + `mswLoader`), `vitest.config.ts` (`storyTests` from `@wren/ui/storybook/tests`), `public/mockServiceWorker.js` (msw init, never in the app build)
- A story: `pageAt(at, { me, answers, mode, check, lands })` (`web/src/mocks/page.tsx`): a memory-history router at `at`; `me` = `OWNER` (a client's owner, every app) or `ADMIN` (Wren's team); `mode` `pending` or `fails` for every read but `delivery/me`; `check` runs once the data is in (the heading, the main actions, words in their boxes); the story fails when the page lands on another address (`lands`)
- Fake server: `web/src/mocks/api.ts`: one table, key = path (`console/call:<Service>.<handler>` for named handlers), value = body or a function of the call's body; `serve<Api>(service, {...})` types the answers with the server's API object; `pulse` fans out to the same table; records answer at `<product>/recordsGet`, and a recording's page on the team side reads `console/recordsGet`
- Unmocked call: a 404 and `unmocked: <key>` in the console; the story's `play` (`settled()`) waits for the server to go quiet and fails on it
- Answers: `web/src/mocks/data/`: `index.ts` (the one table every story reads), `shell.ts` (account, bells, badges), `records.ts` (every records page: the server's types from `virtual:record-types`, rows by field kind), `apps.ts` and `client-pages.ts` (each page's own first read), `me.ts`, one file per domain (`map.ts`, `research.ts`, `variants.ts`, `agent/` tapes). Synthetic only
- Messy data is the default (`setMessy`, `web/src/mocks/api.ts`; the `data` toolbar): every answer is stretched to prod's look (long and non-Latin text). `tidy(story)` pins the hand-made table for a check that reads a hand-made word
- Sidebar groups name the audience and the place: `Wren/…`, `Client/…`. A split file keeps its meta `id`, so story ids don't move (`pages-wren-done` is `pages-wren`; `pages-wren-tabs`, `-done` and `-port` are `pages-wren-apps`).
- Stories: `web/src/pages-*.stories.tsx`, one row per file in the hub's Page stories table. Pending and failed reads are tested once per template (team: `pages-team-places--office-spend-pending`, `-fails`; client: `pages-client-places--project-plan-pending`, `-fails`)
- Guard: `web/src/stories-cover.test.ts` lists every page of `TEAM_PLACES`, `CLIENT_PLACES` and Research and fails on one with no story address, or a story at a moved address
- Checks: `stories:build` in `gates.sh stories` (not in lint since 10-22); `test:stories` (`wren-stories`) in `gates.sh visual` and CI `test:stories`

## Connected to

- **owns:** `apps/portal/web/src/mocks/`
- **owned-by:** [[ui/story]] (the shared kit: frame, story tests, bins `wren-stories`, `wren-storybook`, `wren-shot`)
- **joins:** `createPortalRouter(history)` (`apps/portal/web/src/router.tsx`), `pageOf` (`@wren/ui/fixtures`)
- **looks-like-but-is-not:** the portal preview (`pnpm --filter @wren/portal preview`: a build on a local backend, real data)

## If you change this

- **Hits:** a page that starts a new read fails its story until `data/` answers it; a server route's answer change fails the typecheck where `serve<Api>` types it; a record type the worker adds or changes (`apps/worker/src/record-types.ts`, `console-records.ts`) shows at the next Storybook start
- **Does not hit:** the portal build, prod. the worker's record types load in Node, never in the browser

## Surfaces

| Surface | Role |
|---|---|
| Storybook (:61000) | reads |
| CI `test:stories` | tests every page story (render, play, axe) |

## See

- Design: `designs/2026-10-18-portal-page-stories.md`, `designs/2026-11-05-story-parity.md`
- Skill: `.claude/skills/wren-ui/SKILL.md` (page loop)
