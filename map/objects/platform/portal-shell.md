---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-11 @ 9a5342fc (+ Ads split)
entity: apps/portal/web/src/areas.ts:14
---

# portal-shell

The portal's frame: Today at "/", and one sidebar with every app under its area, the open app unfolded into its pages (designs/2026-10-10-portal-areas.md).

## Why this shape

Areas group apps by job; pages never move between apps, so every link in a ping, a mail or a brief keeps working. One read of every app's waiting counts feeds both the sidebar and Today, so the two never disagree.

## Shape

- `AREAS` (`apps/portal/web/src/areas.ts:14`): Inbox, Leads, Marketing (Marketing, Ads, Sites, Learn), Automations, Business, Tools, by app id; `areasOf` (`:39`) skips ids a workspace lacks, drops empty areas, puts unnamed apps under Tools
- `useWaiting` (`apps/portal/web/src/waiting.ts:48`): per app, per page, rows waiting: a page's `count` in Wren's workspace (`console/recordsList`), its `badge` in any; hidden pages skipped (`readApp`, `:18`); all apps on load and each minute, the open app on each move
- `AppShell` (`packages/ui/src/shell.tsx:113`) takes `home` (Today, its total) and `areas` (`NavArea[]`); `SideNav` (`:389`) draws them, an area of one app with no heading; `AppHead` (`:499`) is the phone's head, a home icon back to Today
- Hover flyouts (2026-10-11): a closed app's `pages` (`NavApp.pages`, built in `App.tsx` beside `areas`) open beside its row on a fine pointer; `useHoverMenu` (`packages/ui/src/safe-triangle.ts`) holds it through the invisible triangle from where the pointer left to the flyout (`graceArea`, `inPolygon`), 350 ms at most; touch never gets them
- `WrenToday` and `ClientToday` (`apps/portal/web/src/today.tsx:146`, `:173`): setup and health alerts, pins, Needs you (every page with rows waiting), Wren's day (`DAY`, `:32`: calls and replies tiles, next calls) or a client's service cards with each app's `Glance`; on a phone, the apps by area
- App wiring (`apps/portal/web/src/App.tsx:465`): areas built from the viewer's apps (`appsIn`, `apps/portal/web/src/modules/index.ts:60`); with one app (the demo) no Today and no areas
- Wren's Inbox holds To approve (`APPROVAL_PAGE`, `apps/portal/web/src/modules/marketing/index.ts:901`) and Done (`DONE_PAGE`, `:884`); Marketing keeps `/marketing/inbox` and `/marketing/approve` as hidden pages for old links; its tabs sort by group (`byGroup`, `:1094`)
- Ads (`ads`, `:1112`) and the site's visitors and search (`SITE_PAGES`, `:1123`, in Sites under Visitors and Search) left Marketing on 2026-10-11 (`designs/2026-10-11-split-marketing.md`); Marketing keeps each as a hidden page for old links; record `app` ids stay `marketing`, so grants are unchanged

## Connected to

- **owns:** nothing stored
- **owned-by:** [[platform/records]] (pages are record lists)
- **joins:** [[platform/saved-views]] (rail pins, Today's tiles under `tiles:today`)
- **looks-like-but-is-not:** a module's `nav` (an app's own tabs read from data, Learn's collections)

## If you change this

- **Hits:** every portal page's frame, ⌘K's first item (Today), each page's tab counts
- **Does not hit:** routes, records, the console API, links in mail and pings

## Surfaces

| Surface | Role |
|---|---|
| portal "/" | Today |
| portal sidebar | every app, what waits in each |

## See

- Source: `apps/portal/web/src/areas.ts`, `apps/portal/web/src/waiting.ts`, `apps/portal/web/src/today.tsx`, `packages/ui/src/shell.tsx`
- Design: `designs/2026-10-10-portal-areas.md`
