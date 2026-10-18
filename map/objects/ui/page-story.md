---
type: object
cluster: ui
universe: live
status: verified
verified: 2026-10-18 @ 04a7d353
entity: apps/portal/web/src/mocks/page.tsx:1
---

# page-story

A whole portal page in Storybook: the real app (router, shell, data layer, batching) at one address, on a fake server (MSW). `pnpm --filter @wren/portal storybook` serves it on :61001 (id `pages-client--<app>`, `pages-wren--<app>`), and each story runs as a test.

## Why this shape

Layout and organization changes need the shell, the router and the reads together, which a part story lacks. Faking at the network (`POST /api/*`) leaves the app unchanged, so a page story cannot drift from the page.

## Shape

- Config: `apps/portal/.storybook/main.ts` (stories `web/src/**/*.stories.tsx`, addons a11y + vitest + msw, `nodeStubs` for server modules the app imports, `dictateOff` for the one GET made at load), `preview.tsx` (ui's frame + `mswLoader`), `vitest.config.ts` (`storyTests` from `@wren/ui/storybook/tests`), `public/mockServiceWorker.js` (msw init, never in the app build)
- A story: `pageAt(at, { me, answers, mode })` (`web/src/mocks/page.tsx`): a memory-history router at `at`; `me` = `OWNER` (a client's owner, every app) or `ADMIN` (Wren's team); `mode` `pending` or `fails` for every read but `delivery/me`
- Fake server: `web/src/mocks/api.ts`: one table, key = path (`console/call:<Service>.<handler>` for named handlers), value = body or a function of the call's body; `serve<Api>(service, {...})` types the answers with the server's API object; `pulse` fans out to the same table
- Unmocked call: a 404 and `unmocked: <key>` in the console; the story's `play` (`settled()`) waits for the server to go quiet and fails on it
- Answers: `web/src/mocks/data/`: `shell.ts` (account, bells, badges), `records.ts` (every records page: generic types made from each page's columns and states, rows by field kind), `apps.ts` (each app's own first read), `marketing.ts`, `me.ts`. Synthetic only
- Stories: `web/src/pages-client.stories.tsx` (each client app, a record open, `Loading`, `Failed`), `pages-wren.stories.tsx` (each of Wren's apps)
- Checks: `stories:build` in `gates.sh` lint; `test:stories` (`wren-stories`) in `gates.sh visual` and CI `test:stories`

## Connected to

- **owns:** `apps/portal/web/src/mocks/`
- **owned-by:** [[ui/story]] (the shared kit: frame, story tests, bins `wren-stories`, `wren-storybook`, `wren-shot`)
- **joins:** `createPortalRouter(history)` (`apps/portal/web/src/router.tsx`), `pageOf` (`@wren/ui/fixtures`)
- **looks-like-but-is-not:** the portal preview (`pnpm --filter @wren/portal preview`: a build on a local backend, real data)

## If you change this

- **Hits:** a page that starts a new read fails its story until `data/` answers it; a server route's answer change fails the typecheck where `serve<Api>` types it; a record page's columns change its generic type
- **Does not hit:** the portal build, prod. Record types are generic, not the server's: a column the server adds shows only in the preview

## Surfaces

| Surface | Role |
|---|---|
| Storybook (:61001) | reads |
| CI `test:stories` | tests every page story (render, play, axe) |

## See

- Design: `designs/2026-10-18-portal-page-stories.md`
- Skill: `.claude/skills/wren-ui/SKILL.md` (page loop)
