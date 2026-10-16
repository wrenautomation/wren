---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-14 @ 3fc09e66 (+ soft look, needs tiers)
entity: apps/portal/web/src/areas.ts:14
---

# portal-shell

The portal's frame: Today at "/", one sidebar with every app under its area, and the open app inside the window: a bar across its top and its pages down its left edge (designs/2026-10-10-portal-areas.md, designs/2026-10-11-portal-look.md).

## Why this shape

Areas group apps by job; pages never move between apps, so every link in a ping, a mail or a brief keeps working. The sidebar never unfolds, so it keeps one shape from app to app. One read of every app's waiting counts feeds both the sidebar and Today, so the two never disagree.

## Shape

- `AREAS` (`apps/portal/web/src/areas.ts:14`): Inbox, Leads, Marketing (Marketing, Outreach, Ads, Sites, Learn), Automations (Workflows, Loops, Library, Marketplace, Voice), Business, Tools (Handlers sits here: a dev tool, designs/2026-10-14-automations.md), by app id; `areasOf` (`:39`) skips ids a workspace lacks, drops empty areas, puts unnamed apps under Tools
- `useWaiting` (`apps/portal/web/src/waiting.ts:62`): per app, per page, rows waiting: every page's `count` in Wren's workspace in one `console/recordsCounts` read, its `badge` in any; hidden pages skipped (`readApps`, `:19`); all apps on load and on the pulse (`apps/portal/web/src/pulse.ts`: one timer a minute, only while the tab shows and the window has focus, plus once on return; beats' reads leave as one `POST /api/pulse`, `apps/portal/src/pulse.ts`, reads only), the open app on each move. The Learn bell rides the same pulse. `call` (`api.ts`) shares one `recordsTypes` read per load; `keepOf` (`records.tsx`) reads prefs once and each record's saved views once, writes update the copy
- `AppShell` (`packages/ui/src/shell.tsx:138`) takes `home` (Today, its total) and `areas` (`NavArea[]`); with areas, a grid puts whose workspace at the sidebar's head and `actions` at its foot; `SideNav` (`:691`) draws the apps, the open one marked, an area of one app with no heading
- The open app on a computer: `AppBar` (`:661`, mark, name, page on screen, its action, the pin) over `AppColumn` (`:742`, its pages grouped, nested, with counts and drop targets; none with one page); `AppHead` (`:1030`) is the phone head only where an app has no nav
- Phone and tablet (under 900px, `PHONE` in `packages/ui/src/phone-shell.tsx`): the bottom bar is always Home first and Apps last (grid col 5), three section tabs between. At home those are `dockOf` (`apps/portal/web/src/areas.ts:78`); inside an app its own pages: `phoneTabsOf` (`areas.ts:168`, picks in `PHONE_TABS`, else one per run) then `barOf` (`packages/ui/src/phone-nav.ts`, `BAR_SIZE` 3). Pages left over list first in the Apps sheet as "More in <app>" and light no tab. Home carries no badge; from an app it reopens Home's own stack. `usePhoneWalk` (`phone-shell.tsx:102`) keeps a back stack per tab in sessionStorage `wren:phone-walk`: a tab reopens where he left it, a tap on the open tab pops to its root, then scrolls up; `useScrollKeep` restores scroll. `PhoneTop` (`:294`) is the iOS bar: back chevron named for the page before, compact title once the h1 scrolls under, group pages as `Segmented`; edge swipe back only in standalone. `navigate` (`apps/portal/web/src/route.ts`) stores `{from}` in history so back uses `history.back()`
- Phone sheets and rows (`packages/ui/src/phone.tsx`): `BottomSheet` (detents, grabber, drag to dismiss) holds an open record (`Panel`, `records.tsx`), More and Apps (`AppsSheet`, `:641`); popovers become bottom sheets under 900px (`components/ui/popover.tsx`). `RowCard` rows are `SwipeRow`s, actions from `swipesOf` (first safe action leads, destructive ones trail). `PullToRefresh` reads every `useLoad` again through `refreshAll` (`packages/ui/src/data/query.ts`). A list's views are `Segmented` (`list-bar.tsx`). Group heads stick under the bar via `--phone-bar`. Full record pages dock actions in a bottom bar. Touch controls take 44px through `pointer-coarse:`. Check Safari: a grid's `auto` column grows to a line-clamped child's width, so stacks of cards use `grid-cols-1`
- PWA: `apps/portal/web/public/manifest.webmanifest` (standalone, icons 192/512), apple-mobile-web-app meta in `apps/portal/web/index.html`
- Routing (2026-10-16, designs/2026-10-16-portal-libs.md): TanStack Router, code routes in `apps/portal/web/src/router.tsx`; the address keeps its flat shape, list search typed by `LIST_SEARCH` (`packages/ui/src/list-search.ts`); `route.ts` (`href`, `navigate`, `useRoute`) wraps it. List bar menus open on hover through Base UI Popover (`useHoverPop`, `packages/ui/src/hover-pop.ts`). `scripts/libs-guard.mjs` fails history calls outside the router
- Hover flyouts (2026-10-11): a closed app's `pages` (`NavApp.pages`, built in `App.tsx` beside `areas`) open beside its row on a fine pointer; `useHoverMenu` (`packages/ui/src/safe-triangle.ts`) holds it through the invisible triangle from where the pointer left to the flyout (`graceArea`, `inPolygon`), 350 ms at most; touch never gets them
- Hover text (2026-10-14): any element with `data-tip` says that text after the pointer rests 400ms, or on keyboard focus, never on touch. `HintLayer` (`packages/ui/src/hint-layer.tsx`, mounted once in `apps/portal/web/src/main.tsx`) draws one tip for the whole page from document listeners, so a long table pays nothing per row. Callers spread `tipProps(text, {keys?, side?, as?})` (`packages/ui/src/hint.ts`, pure: `hintFlow` is the timer, `placeTip` the flip and clamp, `whenTip` the date line "Sep 30, 2026, 5:08 PM ET · 3 days ago"); `clipProps()` says an element's own text only while it is cut short; `dateTip(d)` (`fields.tsx`) is a date's. A disabled button takes no pointer, so the reason it is blocked rides on `Why` around it. Use it for icon-only buttons (name and key), cut-off text, state chips (`State.about`), counts, dates and platform chips; not where the label already says it all
- `WrenToday` and `ClientToday` (`apps/portal/web/src/today.tsx:149`, `:176`): setup and health alerts, pins, Needs you (every page with rows waiting), Wren's day (`DAY`, `:32`: calls and replies tiles, next calls) or a client's service cards with each app's `Glance`; on a phone, the apps by area
- App wiring (`apps/portal/web/src/App.tsx:479`): areas built from the viewer's apps (`appsIn`, `apps/portal/web/src/modules/index.ts:64`); with one app (the demo) no Today and no areas
- Layout (2026-10-11, `designs/2026-10-11-portal-polish.md`): `Display` (`packages/ui/src/display.ts:63`, `readDisplay`) is sidebar and pages widths, either folded, rows, text size, frame, counts, motion, kept as pref `display` (`useDisplay`, `packages/ui/src/frame.tsx:72`; mirrored in localStorage `wren.display` for the first paint). Wren's team keeps one at Wren for every workspace; a client one per workspace. The shell sets `--layout-*` vars on its root and `data-density`/`data-counts`/`data-motion` on `<html>`; text size zooms `main` only
- Panels: `Resizer` (`frame.tsx:241`) on the sidebar's and the pages column's edges (drag, ←/→, Enter folds, double-click resets; past the fold line it folds); a folded sidebar is icons, every app's name and pages in its flyout, the viewer's buttons behind `more`; the app bar's panel button hides the pages and the page name then opens them
- Keys: `useFrameKeys` (`shell.tsx:388`): `[` sidebar, `]` pages, `?` the sheet (`KeysSheet`, `frame.tsx:213`), ⌥↑/⌥↓ the app's page above or below; a page adds its own with `usePageKeys` (`:138`; Learn does). Lists and queues walk with ↑/↓ (J/K too) through `walkKey` (`packages/ui/src/records.tsx:340`), which leaves arrows to menus, listboxes, dialogs and sliders
- Wren's Settings app (`apps/portal/web/src/modules/settings/index.ts`): Layout (`DisplayPanel`, `frame.tsx:391`), Look (his own look in Wren's workspace, pref `look`, read by `useLook` through `myLook` in `App.tsx`), Guide (every app by area with its pages, from `MODULES`, and the keys); a client's Layout sits in Account → Your settings
- Wren's Inbox holds To approve (`APPROVAL_PAGE`, `apps/portal/web/src/modules/marketing/index.ts:901`) and Done (`DONE_PAGE`, `:884`); Marketing keeps `/marketing/inbox` and `/marketing/approve` as hidden pages for old links; its tabs sort by group (`byGroup`, `:1094`)
- Ads (`ads`, `:1112`) and the site's visitors and search (`SITE_PAGES`, `:1123`, in Sites under Visitors and Search) left Marketing on 2026-10-11 (`designs/2026-10-11-split-marketing.md`); Marketing keeps each as a hidden page for old links; record `app` ids stay `marketing`, so grants are unchanged
- Outreach (`outreach`, `apps/portal/web/src/modules/outreach/index.ts`) left Marketing on 2026-10-16 (`designs/2026-10-16-outreach-app.md`): Engage (outbound only), DMs, Invites, People, Thread replies, Places, Accounts, DM copy. No hidden copies: `MOVED` (`apps/portal/web/src/moved.ts`) redirects `/marketing/<page>` to `/outreach/<page>` in the router's `beforeLoad`, search kept. The dock's Engage opens Outreach; records stay `marketing.*`

- Soft look (2026-10-14, `designs/2026-10-03-console-standard.md` Look): radius scale `--ui-radius` 6px, `--ui-radius-panel`, `--ui-radius-sheet` (`packages/ui/src/tailwind.css`, min() keeps 0 square); a bare `border`, a button or a menu item takes the control corner. Panels raise on `--ui-ground` (the window's page area, `shell.tsx`) by `--ui-raise`; popovers `--ui-float`; `FRAME` in `layout.tsx`
- Needs tiers: a page's `needs` (`module.ts`, else its `count`) goes to `RecordList` as `needs`; `tiersOf` and `waitsOn` (`packages/ui/src/records.tsx`) put waiting rows first under "Needs you", the rest under "For info"; off when grouped or sorted by hand. To approve names `needs` without a `count`. Today's Needs you and Waiting on you show a count (`Section` `count`)
- Stale tabs (2026-10-14): every push deploys the portal and the deploy keeps only the new build's files, so a tab opened before it fails the first lazy file it asks for (the graph on Workflows → Canvas, charts, notes) and used to show "This page hit a problem". `isStaleChunk` and `reloadOnce` (`apps/portal/web/src/stale.ts`) reload it once (sessionStorage `wren:stale-reload`, 30 s guard); `Contained` (`contained.tsx`) and the `vite:preloadError` listener (`main.tsx`) both call it; a second failure says "Wren was updated" with Reload
- Command events (2026-10-13): `call` (`apps/portal/web/src/api.ts:189`) is the one place every user command leaves the portal; it tells `tellAutotrack` (`autotrack.ts`) which posts `{autotrack:{v:1, action, detail:{ids?, ok, error?}}}` to the window for autotrack's extension. Reads say nothing; never a field value or the server's error text. Not covered: `uploadFile`'s PUT, dictation audio, live notes (socket), the public booking page's `fetch`

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
| portal /settings | Wren's Layout, Look, Guide |

## See

- Source: `apps/portal/web/src/areas.ts`, `apps/portal/web/src/waiting.ts`, `apps/portal/web/src/pulse.ts`, `apps/portal/web/src/today.tsx`, `packages/ui/src/shell.tsx`, `packages/ui/src/frame.tsx`, `packages/ui/src/display.ts`
- Design: `designs/2026-10-10-portal-areas.md`, `designs/2026-10-11-portal-polish.md`
