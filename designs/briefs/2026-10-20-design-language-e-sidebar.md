# Brief E: sidebar (wa-7oo.9)

Build this after A is committed, as its own commit. Design: `designs/2026-10-20-design-language.md`, sections "Sidebar (William, 2026-10-20)" and "Decisions (planner, 2026-10-20)". Look: artifact section 07 (`designs/2026-10-20-design-language/design-language.src.html`). The doc's five items win over the section 07 mock.

## Build

1. **Five fixed items.** Map (home), Inbox, People, Money, Admin. Map is the home at `/` (the shape graph). Admin is the Settings app with a new Systems page; extend Settings, do not add a second admin app. An item a workspace lacks is skipped.
2. **Other apps.** They leave the sidebar. They open from the Map's node panel (`map/NodePanel.tsx`, `map/routes.ts`), from Admin → Systems, from pins and from ⌘K. Every route still works.
3. **Admin → Systems.** Every app the viewer may open, in two groups:
   - "On your shape": an app that a live shape node opens through `ROUTES` in `map/routes.ts`. The row names those nodes.
   - "Not on the shape": the rest (handlers, loops, review, marketplace and the like).
   - A parked app is in neither.
   `ROUTES` stays the one kind-to-app table. Add one shared function next to it (for example `appsOnShape(shape, place)`), with unit tests. No second table.
4. **Pins.** Use the existing rail pins (`RailPref`, `usePref`, `pinLines`, `togglePin` in `App.tsx`). They show under the five. No second store.
5. **⌘K.** `packages/ui/src/palette.tsx` (cmdk) already finds apps, pages and records. Make sure every app and page is in `items`, the sidebar hides them or not. Add stations: a finder over the live shape's nodes that opens each node on the Map. No new palette.
6. **Phone dock.** Map, Inbox, People, then the first pin. Replace `DOCK_TEAM` and `dockOf` in `areas.ts`.
7. **Client workspace.** The same five. Admin → Systems needs the `manage` permission (`packages/core/src/access.ts`; there is no `settings` permission).
8. **Look.** Section 07: nav items take `--ui-leaf-nav` and the `aria-current` sweep from A; group labels in sentence case.

## Files you own

- `apps/portal/web/src/areas.ts`, `areas.test.ts`, `App.tsx` (sidebar, dock and palette assembly), `map/routes.ts` (add only), the Settings module, `modules/settings/Guide.tsx` if it reads areas, `today.tsx` only where it reads `areasOf`
- `packages/ui/src/shell.tsx` rail and dock, `shell.stories.tsx`, `palette.tsx` only if a change is needed
- The portal page stories that show the sidebar

## Checks

- Update `areas.test.ts`. Unit tests for the Systems grouping and the dock.
- Stories: render, play, axe only. Sidebar story for Wren's team and for a client; a Systems page story with synthetic apps and nodes.
- While you build: `./scripts/gates.sh changed`, or `vitest run <file>`. Never `tsc`, `turbo` or `vitest` for the whole repo.
- Repo is public: synthetic data only. Never run against the live portal.

## Commit

`git commit -- <paths>`, separate from A. Message ends with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PpzL4T1jZXndKhYDqy2SGC
```

Do not push. Do not run the full gate; the planner runs it.

## UI rules (William, 2026-10-20)

- Data through TanStack Query only. No ad hoc fetch state in components.
- Loading states match the artifact's section 14 "Loading" (`design-language.src.html`, section id `loading`). The coordinator adds it to the repo copy; pull or read it from `/Users/williamjin/Documents/wren_automation/wren/designs/2026-10-20-design-language/design-language.src.html` before you build loading states. If it is not there yet, build the rest first.
- Popovers and sheets close on outside click and on Esc.
- State persists across navigation. A query that was loading when the person left still shows loading, then its data, when they come back. Keep it in the query cache, never in component state.
- Open sheets, zoom level and pins are remembered per viewer (viewer prefs, `usePref`).
- Systems page: keep it simple and grouped. A first cut is fine.
