---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-23 @ 135454e3
entity: packages/core/src/saved-views.ts:40
---

# saved-views

What a viewer keeps of the portal (designs/2026-10-06-library-and-views.md, steps 1 and 2): saved views of any list, and prefs by key (a list's last view and columns, his tab order, his rail pins, his Overview tiles).

## Why this shape

The list's address already holds its whole state, so a saved view is that address as a query string, nothing new to model. Prefs are one key-value table per viewer and workspace, so the rail, tiles and favorites need no table each. Tab order is a pref, so a shared view moves only on the screen of whoever moved it.

## Shape

- `saved_views` (`packages/core/src/schema.ts:380`, migration 0130): workspace (a client's id or `wren`), viewer, record, name, params, shared, position
- `viewer_prefs` (`:405`): workspace, viewer, key, value; keys `list:<record>` (`{sv, view, sort, cols, as}`, `as` rows or cards; `lastOf`, `restoreOf` in `list-bar.tsx`), `views:<record>` (his tab order), `rail` (`{pins}`, page paths), `tiles:<app>.<page>` (`{order, hidden}` by tile label); `favorites:<record>` (ids, [[platform/library]]'s snippets); null deletes (Reset)
- `savedViewsOf`, `saveView`, `removeView`, `moveViews`, `prefsOf`, `setPref` (`packages/core/src/saved-views.ts`); a save drops `after`, `pg`, `sv`, `tab`
- served by `ConsolePortal{savedViews,saveView,removeView,moveViews,prefs,setPref}`, need `read`; `keeper` (`packages/core/src/console/console-api.ts:828`) scopes to Wren's apps or the client asked for, refuses the demo's writes, and sharing or changing a shared view needs `manage` there
- drawn by `ViewTabs`, `ListBar`, `SaveView`, `FilterSheet`, `useLastUsed` (`packages/ui/src/list-bar.tsx`) in `RecordList` and `RecordQueue`; the portal binds `RecordsApi.keep` per workspace (`keepOf`, `apps/portal/web/src/records.tsx`)
- Customize (`packages/ui/src/customize.tsx`): `PinnedRail` on every app's rail (drag or Alt+arrow to move, × unpins, Unpin all), `PinButton` at the rail's foot and in a phone's head, `PinnedRow` on Today, `TilesMenu` beside an Overview's title (tick, move, Reset to default). `usePref` changes the screen first, reads back on a failed write. A pin to a page he can't see now stays kept, unshown (`pinLines`, `apps/portal/web/src/App.tsx`)
- Hover text: every tab, saved tab, quick-filter pill, the Filter button, a Filter sheet row and a platform chip says in plain words what it keeps (`packages/ui/src/view-says.ts`: `sayView` reads a built-in tab's `where` and `sort` the way the server runs them, a `SavedView.hint` wins; `saySaved` reads a saved tab's query string; `sayFilters`/`sayRaw` the filters set now; `tipProps` (`packages/ui/src/hint.ts`) puts it on `data-tip` for the hover layer, see portal-shell)
- The Map's views (designs/2026-10-23-focus-view.md, F2): record `map` (`MAP_VIEW_RECORD`), params `parts=<partsParam>` (`packages/pipeline/src/metro-parts.ts`); pref `map.home` holds the view "/" opens on. Drawn by `FocusPage` at `/map/view/<id>` and `/map/parts/<…>` and by `MapViews` in the Map's tools (`apps/portal/web/src/map/views.tsx`); saved through `SaveViewPop` (`list-bar.tsx`). `wren shape view list|show` reads them (shared only, unless `--viewer`)
- A list opens on the viewer's last view (a saved one with its filters) unless the link names a view, sort or columns; a link with only filters still gets his columns; rows or cards follow him unless the link names `as` or a saved view

## Connected to

- **owns:** `saved_views`, `viewer_prefs`
- **owned-by:** [[platform/records]]
- **joins:** [[clients/client-member]] (`manage` to share, by role)
- **looks-like-but-is-not:** a record type's `views` (built-in tabs declared in code); `clients.look` (the portal's look for a whole client)

## If you change this

- **Hits:** every list and queue page's tabs and bar, the local preview (it serves the console api, so these work there)
- **Does not hit:** record reads, export, the demo (it keeps nothing)

## Surfaces

| Surface | Role |
|---|---|
| portal list and queue pages | write (save, rename, share, move, delete, last view), read |
| portal Map focus pages and "/" (record `map`, pref `map.home`) | write (save, update, home), read |
| `wren shape view list\|show` | read |

## See

- Source: `packages/core/src/saved-views.ts`, `packages/ui/src/list-bar.tsx`
- Tests: `packages/core/test/integration/saved-views.test.ts`
