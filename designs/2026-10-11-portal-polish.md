# Portal polish: layout you set, keys you'd guess

2026-10-11. William: "more polished", "take the best of all aspects of various UI libraries", "vertical sidebars being adjustable", "more config options", "arrow keys instead of j and k".

## What we took, from where

| From | Took | Where |
|---|---|---|
| Linear | Drag a panel's edge; `[` folds the sidebar; key caps beside every hint | `Resizer`, `useFrameKeys` |
| shadcn sidebar | Folds to icons; names and pages in a flyout | `SideNav` folded |
| Radix Themes ThemePanel | One panel for every frame setting, segmented choices | `DisplayPanel` |
| Mantine / Ant | Row density as a token, not per-component props | `--layout-row`, `data-density` |
| Geist | Key cap part with a heavier bottom edge | `Key` |
| GitHub, Gmail | `?` opens every key; the page adds its own | `KeysSheet`, `usePageKeys` |
| WAI-ARIA window splitter | The edge is a focusable separator: ←/→, Home/End, Enter | `Resizer` |

Not taken: floating panels (VS Code), per-view layout (Notion). One layout per person is enough for now.

## The settings

`Display` in `packages/ui/src/display.ts`: sidebar full, icons or hidden (WA-1380), sidebar width (184-360, folds below 140), pages width (160-320, hides below 110), rows roomy or snug, text small/normal/large (zooms the page, not the frame), the canvas around the window on or off, counts on or off, motion full or less.

Kept as pref `display`, only what differs from the defaults. Wren's team keeps one at Wren, the same in every workspace. A client keeps one per workspace. localStorage mirrors it so the first paint is already his.

## Keys

- Lists and queues: ↑/↓ move, J/K still work. Arrows inside a menu, listbox, dialog, tab list, radio group or slider stay theirs.
- `[` folds the sidebar to icons, `\` hides it, `]` hides the app's pages, `?` the sheet, ⌥↑/⌥↓ the app's page above or below, G then a letter, ⌘K.
- Learn's cards take ←/→ too.

## The sidebar's three states (WA-1380)

Hidden is for a product that must look standalone, as in a demo video. On a computer it draws the frame with no areas: a slim bar (brand, workspace, Layout, You) and the app's pages at the window's left. A phone keeps its tabs in every state.

| State | Shows (computer) | Enters by | Next | Motion out |
|---|---|---|---|---|
| Full | names and marks, app's pages under the open app | default; `[` or `\` from the others; Layout; drag past 140 | Icons, Hidden | cross-fade (view transition) |
| Icons | marks alone; the app's pages at the sidebar's edge | `[`; Layout; drag under 140 | Full, Hidden | cross-fade |
| Hidden | slim top bar; the app's pages at the window's left (`]` still hides them) | `\`; Layout | Full (`\`, Layout), Icons (Layout) | cross-fade |
| No app open, hidden | slim bar and the page alone | home while hidden | as Hidden | cross-fade |
| Less motion | as above | Layout's Motion: Less, or the system's reduced motion | as above | instant: the setting asks for it (MO-4) |
| Phone (390) | its own bar and tabs, no change | any state | as above | none: the phone draws no sidebar |

A drag ends the same way in Hidden as in Full: the resizer is only drawn in Full and Icons. A second key press during a fade skips the first one (the browser's rule), with no error.

## Wren's Settings app

Layout, Look (his own colors in Wren's workspace; a client's workspace keeps the client's look), Guide (every app by area with its pages, built from the live module list, then the keys). Clients get Layout under Account → Your settings.

## Decision log

- 2026-10-11: frame vars are `--layout-*`, not `--ui-*`: a client's look can't set widths.
- 2026-10-11: text size zooms `main` only. Zooming the frame broke fixed flyouts and `100dvh`.
- 2026-11-13: the sidebar gets a third state, hidden, as a `sidebar` field that replaces `sideShut` (an old `sideShut: true` reads as icons). Hidden reuses the no-areas frame, not a new one: one top bar to keep right. Rejected: a full-screen "demo mode" that also hides the bar. The slim bar keeps Layout in reach to bring the sidebar back. (WA-1380)
