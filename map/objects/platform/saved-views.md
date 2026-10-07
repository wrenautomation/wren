---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-06 @ 60d4dea
entity: packages/core/src/saved-views.ts:40
---

# saved-views

What a viewer keeps of the portal (designs/2026-10-06-library-and-views.md, steps 1 and 2): saved views of any list, and prefs by key (a list's last view and columns, his tab order, his rail pins, his Overview tiles).

## Why this shape

The list's address already holds its whole state, so a saved view is that address as a query string, nothing new to model. Prefs are one key-value table per viewer and workspace, so the rail, tiles and favorites need no table each. Tab order is a pref, so a shared view moves only on the screen of whoever moved it.

## Shape

- `saved_views` (`packages/core/src/schema.ts:380`, migration 0130): workspace (a client's id or `wren`), viewer, record, name, params, shared, position
- `viewer_prefs` (`:405`): workspace, viewer, key, value; keys `list:<record>` (`{sv, view, sort, cols}`), `views:<record>` (his tab order), `rail` (`{pins}`, page paths), `tiles:<app>.<page>` (`{order, hidden}` by tile label); null deletes (Reset)
- `savedViewsOf`, `saveView`, `removeView`, `moveViews`, `prefsOf`, `setPref` (`packages/core/src/saved-views.ts`); a save drops `after`, `sv`, `tab`
- served by `ConsolePortal{savedViews,saveView,removeView,moveViews,prefs,setPref}`, need `read`; `keeper` (`packages/core/src/console.ts:1285`) scopes to Wren's apps or the client asked for, refuses the demo's writes, and sharing or changing a shared view needs `manage` there
- drawn by `ViewTabs`, `ListBar`, `SaveView`, `FilterSheet`, `useLastUsed` (`packages/ui/src/list-bar.tsx`) in `RecordList` and `RecordQueue`; the portal binds `RecordsApi.keep` per workspace (`keepOf`, `apps/portal/web/src/records.tsx`)
- Customize (`packages/ui/src/customize.tsx`): `PinnedRail` on every app's rail (drag or Alt+arrow to move, × unpins, Unpin all), `PinButton` at the rail's foot and in a phone's head, `PinnedRow` on the launcher, `TilesMenu` beside an Overview's title (tick, move, Reset to default). `usePref` changes the screen first, reads back on a failed write. A pin to a page he can't see now stays kept, unshown (`pinLines`, `apps/portal/web/src/App.tsx`)
- A list opens on the viewer's last view (a saved one with its filters) unless the link names a view, sort or columns; a link with only filters still gets his columns

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

## See

- Source: `packages/core/src/saved-views.ts`, `packages/ui/src/list-bar.tsx`
- Tests: `packages/core/test/integration/saved-views.test.ts`
