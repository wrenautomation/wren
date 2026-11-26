# Raycast light: Wren's own look, and Aerie Tasks like Backlog.md

Tasks WA-1452 (look), WA-1454 (Aerie Tasks). The To approve bento (WA-1453) gets its own doc. Brand mark: WA-1451 (other session).

William, 11-26: "ok for tasks lets just copy how backlog.md does it (column view, togglbale into a list view with like a panle ont eh right to view) for aerie so combining both the jira esque list and the column view, and also subtler naimations sinc ewell click into these a lot / i like raycast light, i don'tlk hte hyper shiny ball + bird logo well think of new line art design for our company to hav e aunique brand well tune that as a sepparate variant / to approve a s abucnh fo bento cards is fne. lets lock in those, maybe start makigna  storybook / transfering wren over to that."

Earlier (via the sidecar session): "we're not gonna make a whole new ui system, i think wren in its current shape is good enough to refactor and build off of."

## Target state

- Wren's own portal can wear Raycast light: a pastel wallpaper, a glass sidebar, a white page, white cards, Schibsted Grotesk, ink buttons, colour in words. Purple only in the map's line-0.
- Clients keep their plain looks. Nothing they see changes.
- Aerie Tasks has Board and List. The List docks the open task in a pane on the right, the way the Backlog.md terminal board does.
- The shell keeps its shape (side nav, top bar, one window). The change is tokens plus one blur layer in `shell.tsx`.
- Later (William, 11-26, newest): "the enevutal state should look like our variants int he past batches rightlike the final variants and aerie view". The end state is v116's shape too: top-nav pills, Anton as a docked panel, Aerie columns as v116 draws them. That work is the Redesign doc (`designs/2026-11-26-redesign.md`, WA-1456). This doc stays the look's tokens.

## Non-goals

- No new UI kit. The style set's CSS is not ported. The Redesign doc builds v116's shape from `@wren/ui` parts, not from the style set's CSS.
- No look change for clients, and no flip of Wren's default in this work. William switches in Settings → Look.
- No new mark. The orb and the bird stay out of wren; WA-1451 brings a mark.
- No change to shared `Rows` hover or to the kit sheet's default timing.

## Source order for this look

The style set's v116 (`raycast-light-jira`) and v119 (`raycast-jira`) give colour and material for the `raycast` looks: https://0af8df62.wren-style-set.pages.dev/v116/, canon `topics/ui-design/builds/2026-11-25-wren-style/` (`variants.mjs`). The design-language artifact stays the judge for structure, and for every other look. `designs/2026-10-21-artifact-match.md` carries this line.

## D1. Where the look lives (built)

| Option | How | For | Against |
|---|---|---|---|
| A. A showcase look | `raycast` and `raycast-night` in `theme.tsx` `SHOWCASE`; Wren's workspace picks it in Settings → Look | the kit's own look system; clients never get it (Quiet Client Rule); undo is one setting | the base look stays for clients; two looks to keep |
| B. Rewrite the base | `BASE` and `tailwind.css` `:root` become Raycast light | one look | every client gets glass and a wallpaper at once |
| C. A new kit from the style set | port `layouts-f.mjs` CSS into new parts | the closest copy of v116 | "not a whole new ui system"; two token sources |

Ranked by: clients unaffected > one token source > easy undo > less code. **Picked A.**

The values live in `packages/ui/src/theme.tsx` (`SHOWCASE.raycast`, `SHOWCASE["raycast-night"]`). The doc lists only where they leave v116, and what is ours.

**New tokens** (in `TOKENS`, BASE and `tailwind.css` `:root`):
- `window`: the window's ground. Default `var(--ui-paper)`; raycast `rgb(255 255 255 / 0.62)`, v116's panel.
- `window-blur`: `blur(36px) saturate(1.6)`, v116's glass. It sits on its own layer under the sidebar. On the window it would trap the window's fixed children.
- `numeric`: the figure style. BASE `tabular-nums`; raycast `normal`. Schibsted's tnum sets `,` `.` `:` at figure width (9.53 px), which opens a gap in "1,234" and "10:30". Table number columns (`records-columns.tsx`) read the token, so in raycast their figures are proportional.

**The Quiet Client Rule.** `setLook` refuses showcase looks for clients. `SHOWCASE_LOOKS` lists both raycast looks, and `showcaseIn` flags a manual look that sets `window` or `window-blur` (`packages/core/src/console/api/requests.ts`).

**Ours, not v116:**

| Token | Value | Why |
|---|---|---|
| `accent`, `press-edge` | `#1d1d22`, flat | v116's ink Approve button. Primary, active and current-tab washes go grey, not purple. No lip under the button |
| `link` | `#2450c4` | v116's `#3a6df0` fails 4.5:1 on the grey washes |
| `live`, `chart-1` | `#2450c4`, `#3a6df0` | both follow accent by default. An ink run pulse reads dead, and ink is no series colour |
| `good-ink`, `bad`, `warn-ink` | deepened | the cooler canvas drops them under 4.5:1 |
| `ink-3` | `deepInk3`: `#55555e` mixed 68% toward ink | as v116 draws it |
| `backdrop` | v116's veil over `WALL.light` | the wall at about half, as v116 |
| `tile`, `edge`, `hover` | `#f5f6f8`, black 14%, black 4% | v116 has no such parts; tuned in Storybook |
| `radius` | 8 px, plain corners (no leaf) | v116 `rs` |
| font | Schibsted Grotesk, self-hosted (`@fontsource-variable/schibsted-grotesk`, OFL) | v116's font. Its files load only when a look names it |

`raycast-night` is v119 with an opaque `paper` (`#232326`), night status inks, and the same blue `live` and `chart-1`. Its v119 card (`rgba(255,255,255,.05)`) would leave menus see-through.

### D1a. Where the glass stops

The first build put glass on the whole window. Pages paint opaque parts in `--ui-paper` (sticky heads, table columns, panels), so they showed as white blocks on a tinted glass.

| Option | How | For | Against |
|---|---|---|---|
| A. Glass at the sidebar; the page column is paper | the frame div paints `--ui-paper`; the blur layer is the sidebar's width | no page changes; every sticky part matches its ground | less glass than v116's window |
| B. Glass main bands, sticky paper parts | the page ground is glass; each sticky head stays paper | closer to v116 | sticky heads read as white bands over glass on every page |
| C. Glass-aware sticky parts | sticky parts paint `--ui-window` | the most glass | fails inside cards and sheets, where the ground under a sticky part is paper, not glass |

**Picked A.** v116 itself keeps its board and table on white cards; only its side panel is bare glass. The sidebar `ground` is `transparent` in raycast, so it is the bare glass.

Reduced transparency: the blur layer hides and the window paints `--ui-paper`. Under 900 px the window is paper, as before.

## D2. Aerie Tasks like Backlog.md (WA-1454)

**Precedent.** `backlog board` (Backlog.md 1.55 terminal board): Tab turns the board into a list, about 40% wide, with a Details pane on the right. The pane follows the cursor. The web view of Backlog.md opens a modal and is not the precedent. In the kit, the List template docks an open record the same way (`records-list.tsx`, `minmax(0,1fr) minmax(0,420px)`).

Copy the structure only. Backlog's priority stripe, left-edge status glyphs, mono ids and cut titles each break a standing rule (no stripes, no left-edge circles, no tech hints, whole text).

**Views.** The Segmented switch keeps List and Board. Tab is not bound: on the web it moves focus. Columns (the Finder-style layout) stays until William decides (Open).

**List.** The split reuses parts that exist:
- Left: `TaskList` with a prop that forces its narrow shape. That is `PageRows narrow`, the phone row: key, summary, area, priority, people.
- Right: `TaskBody bare`, as Columns uses it.
- The page measures main with `useRoom` (from `records-columns.tsx`; export it). At about 800 px and wider, the split mounts. The pane takes 60%, as Backlog's 40/60. Narrower, a task opens in the sheet, as now. Main narrows when the agent panel opens, so the viewport is the wrong measure.

**Picks.** The address holds the pick (`task`, replace, not push).
- No `task`: the pane says "Pick a task". No auto-pick: the first row would change under a live sort.
- The walk moves from `TaskSheet` up to the page. It is built on the kit's `walkKey` (↑ ↓ j k; export it). It serves the split and the sheet.
- ↓ or j with no pick, or with the picked task filtered out, goes to the first row in view order.
- Focus stays on the row. The pane scrolls on its own.
- Layout links (List, Board, Columns) drop `task`. Else a List pick pops a sheet over the Board.

**Board.** As now; a card opens the sheet. The Redesign doc's D4 changes its columns, heads and card (`designs/2026-11-26-redesign.md`).

| State | What shows | Enters on | Next | Motion out |
|---|---|---|---|---|
| Split, no pick | rows; the pane says "Pick a task" | List opens wide | picked | instant |
| Picked | the row has the selected fill; the pane shows the task | click, ↑ ↓ j k | another pick, filtered out | instant (MV-1: hundreds a day, keys) |
| Picked task filtered out | the pane keeps it; no row is filled | a filter change | picked (↓ goes to the first row) | instant |
| Loading | row skeleton and pane skeleton | first open | split | fade, as `Loading` does |
| Empty, empty filter, failed, no actor | the page's own states, full width; no pane | as now | as now | as now |
| Long title | wraps in the row and the pane | data | | |
| Live change | the row's wash plays once (the kit's fill pulse on a changed row); the pane updates in place | live topic | | the wash (rare) |
| Writes off | the pane is read only, as the sheet is | `board.writes` false | | instant |
| Narrow (under ~800 px main) and 390 | no pane; a press opens the sheet | width | | the sheet's own |

**Motion.** "subtler naimations sinc ewell click into these a lot". Layout switch and row pick: instant. `DetailSheet` gets a `quick` prop; `TaskSheet` passes it: 160 ms fade and 8 px slide, no slide under reduced motion. Shared `Rows` hover stays at 150 ms. This leans on MV-1 against MO-1 (`canon/rules/ui-design/`, open conflict `conflict-ui-motion-frequency-gate`); his sentence is the owner's word for this page.

## D3. To approve as bento cards (WA-1453)

Moved to its own doc. To approve is the shared records page clients also see at `/today/approve`, so the bento is scoped to Wren's workspace. Start points: the kit's Shop template and `Rows` `cards` mode.

## Proof

- Contrast test (`contrast.ts`): both raycast looks, with the grounds `ground/window` and `window/canvas`.
- Storybook (`:61000`): the `look` toolbar global (wren or raycast) draws the wallpaper behind each story. Shots at 390 and 1280 of the AppShell and To approve stories in both raycast looks; box-fit; tells; a fresh-eye review against v116.
- WA-1452 proof: scratchpad `proof-1452/`. 0 tells FAILs on changed lines.

## Open

- Columns layout: keep or drop. Owner: William.
- Story tests run only the `wren` look. A `raycast` pass on the shell and Aerie stories comes with WA-1454.
- Default flip for Wren's workspace. Owner: William (Settings → Look).

## Log

- 11-26: D1 picked A. D2 and D3 written. The default flip is a setting.
- 11-26: goldfish review (critic, reader, zoom-out): 41 findings, 36 applied (most in the smaller zoom-out form), 5 rejected (Explorer as a D2 option, the wallpaper-stop contrast test, three reader points the code disproves); open: Columns, the default flip.
- 11-26: D1a picked A after the proof shots: whole-window glass showed paper blocks on glass. New token `numeric` after the shots showed wide comma gaps in table figures.
- 11-26: William asked for v116 as the end state. This doc kept the side nav and changed only tokens: smaller than he meant by "transfering wren over to that". The shape moves to the Redesign doc (WA-1456).
