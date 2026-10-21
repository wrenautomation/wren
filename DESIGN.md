---
name: Wren Portal
description: The look of the Wren portal and its client products. Leaf corners, warm paper, one lavender accent, dense calm lists. Derived from packages/ui as shipped.
colors:
  canvas: "#f3f1ec"
  paper: "#ffffff"
  ink: "#0e0e0e"
  ink-2: "#56564f"
  ink-3: "#63645e"
  accent: "#6a5a93"
  on-accent: "#faf7f2"
  press-edge: "#4c416a"
  good: "#17803d"
  good-ink: "#136b33"
  warn: "#b7791f"
  warn-ink: "#895911"
  bad: "#c31c15"
  line-0: "#6a5a93"
  line-1: "#2f8a80"
  line-2: "#c0567f"
  line-3: "#3d78b8"
  line-4: "#a04c9c"
  line-5: "#2b84a3"
  line-6: "#6f8a2a"
  line-7: "#5a66c4"
typography:
  page-title:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: 28px
    fontWeight: 600
    lineHeight: 34px
    letterSpacing: -0.022em
  section-title:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 22px
  body:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.55
  row:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
  dense:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.4
  label:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: 12.5px
    fontWeight: 650
    lineHeight: 16px
rounded:
  control: 6px
  panel: 10px
  sheet: 14px
  full: 9999px
  leaf-panel: 6px 24px
  leaf-button: 6px 10px
  leaf-chip: 3px 10px
  leaf-nav: 3px 12px
spacing:
  frame: 10px
  row: 40px
  row-snug: 32px
  nav-row: 34px
  tab-row: 34px
  side: 190px
  pages: 208px
  main: 1240px
  touch: 44px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.dense}"
    rounded: "{rounded.leaf-button}"
    height: 32px
    padding: 0 12px
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.dense}"
    rounded: "{rounded.leaf-button}"
    height: 32px
    padding: 0 12px
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.row}"
    rounded: "{rounded.control}"
    height: 32px
    padding: 0 10px
  frame:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.leaf-panel}"
    padding: 16px
  dialog:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: 16px
  list-row:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.row}"
    height: 40px
---

# Design System: Wren Portal

This file wins over `designs/2026-10-03-console-ui.md`, `2026-10-03-console-standard.md`, `2026-10-04-borrowed-ui.md`, `2026-10-11-portal-look.md` and `2026-10-11-portal-polish.md` where they differ. Those files stay as history.

Source of truth is `packages/ui/src`. Each section names its file. Change the code and this file together.

## Overview

**Creative North Star: "The Quiet Desk."** A warm paper window sits on a warm canvas. It holds dense lists, small type and hairlines. Almost everything is gray. Color appears only when something happened or something waits on the person. The bar is a high-ticket tool (Stripe, Linear, Attio) with Notion and Slack corners.

Mode: Operate. Scan speed, one way to do each thing, and native expectations beat expression.

Key characteristics:
- Leaf corners: two tight corners and two round ones, on panels, bands, buttons, chips and nav rows. A lavender sweep runs along the two round tips. The window and sheets stay at 14 px.
- One accent, Smoky Lavender, used rarely and only through role tokens.
- Figtree Variable at 13 to 15 px for the app. Tabular figures everywhere.
- Hairline borders. Raised surfaces use a ring plus a soft shadow.
- Outcome first. Every number links to its rows. Empty states say what fills them.
- Motion marks real events: a row changed, a run is live, a button is busy.
- The leaf and the sweep are the motif. They echo the mark's feather. The old wing mark and `--ui-motif` stay removed (2026-10-14).

**The Source Rule.** Tokens live in `packages/ui/src/tailwind.css` (`:root`) and are overridden per look by `packages/ui/src/theme.tsx`. A part reads `var(--ui-*)`. It never writes a hex.

**The Quiet Client Rule.** Clients get the plain presets only. Showcase looks, backdrops, grain and lift belong to Wren's own portal. `setLook` refuses them for a client. The leaf, sentence case and the sweep are the Wren look and its night. A look that sets its own `radius` gets plain corners and no sweep: `themeVars` sets the leaf tokens to its plain radius and `--ui-sweep` to 0. A look that wants uppercase sets it in its own preset (`CAPS` in `theme.tsx`). `theme.test.ts` checks each rule.

## Colors

Source: `packages/ui/src/tailwind.css` (`:root`, light "Wren" preset). Values in the frontmatter are normative.

### Core
- **Warm Canvas** (`--ui-canvas`): the page behind the window. Also the tile ground.
- **Paper** (`--ui-paper`): the window, frames, cards, inputs.
- **Ink** (`--ui-ink`): titles and body text.
- **Ink 2** (`--ui-ink-2`): secondary text. 7.4:1 on paper.
- **Ink 3** (`--ui-ink-3`): dates, counts, hints. 4.5:1 on every ground.
- **Smoky Lavender** (`--ui-accent`): the one accent. Deeper than the profile-picture lavender so it holds 4.5:1 on every ground. Text on it is **On-Accent Cream** (`--ui-on-accent`).

### Status
- **Done Green** (`--ui-good`, ink `--ui-good-ink`).
- **Waiting Amber** (`--ui-warn`, ink `--ui-warn-ink`): waiting on you. Only for things that need a person, such as a late tag. The sidebar count is an accent pill.
- **Failed Red** (`--ui-bad`).
- Not started is gray (`--ui-ink-3`).

### Derived (all mixes, in `tailwind.css`)
| Token | Is | Use |
|---|---|---|
| `--ui-wash` | 50% canvas over paper | row hover, tier and group bands, empty hints |
| `--ui-band` | 75% canvas over paper | head strips: table heads, section titles, dialog head and foot |
| `--ui-hair` | ink 22% | every border and rule |
| `--ui-edge` | ink 32% | around inputs, table head underline |
| `--ui-fill` | ink 6% | pressed, selected row, chip fill |
| `--ui-hover` | ink 4.5% | row hover and cursor |
| `--ui-glass` | paper 88% | phone bars (with blur) |
| `--ui-scrim` | shade 16% | behind dialogs and sheets |
| `--ui-accent-wash` / `-tint` | accent 7% / 10% | current page, current tab, selected tile |
| `--ui-good-tint`, `--ui-bad-tint`, `--ui-warn-tint` | 10%, 6%, 9% | Tag and count grounds |
| `--ui-ground` | canvas 55% over paper | the sidebar's ground inside the window |

### Role tokens
`--ui-primary`, `--ui-active`, `--ui-link`, `--ui-focus` and `--ui-live` all resolve to the accent. Parts take a role, never `--ui-accent` itself. A look can re-point one role.

### Cues
`--ui-cue-1` to `--ui-cue-8`: `#6b84b8 #4f9a8f #9a8fc4 #b77a62 #a86f9e #5f97b8 #8f9a5c #b8738a`. They tell kinds of things apart (`TintSwatch`, `tintWash` in `marks.tsx`). They never mean status.

### Lines
`--ui-line-0` to `--ui-line-7`: `#6a5a93 #2f8a80 #c0567f #3d78b8 #a04c9c #2b84a3 #6f8a2a #5a66c4`. Night: `#a596d6 #5cc3b6 #e588ac #7fb0e6 #d493d0 #6bc0de #a9c25f #97a1ec`. They draw lines (chart series, map ribbons, rules that name a thing). Each reads at 3:1 on paper, day and night (`contrast.test.ts`). Lines 4 to 7 keep clear of amber and red, so they never read as status. They never mean status.

### Chart
`--chart-1` accent, `--chart-2` ink-2, `--chart-3` good, `--chart-4` accent 45% over paper, `--chart-5` ink-3.

### Other looks (`theme.tsx` PRESETS)
- **night** (dark): canvas `#0d0d0c`, paper `#171716`, ink `#f2f0ea`, accent `#a596d6` (lavender), on-accent `#15121f`, press edge `#7a69ad`. Keeps the leaf and the sweep. Lines are lighter (below).
- **soft**: canvas `#eef1f6`, accent `#3552d4`, rounded system font, radius 12 px, plain corners, sentence case.
- **editorial**: canvas `#f4f1ea`, paper `#fffdf8`, accent `#1d5a45`, serif display, radius 6 px (plain corners), uppercase labels and buttons, frame 0.
- Showcase (Wren only): aurora, synthwave, terminal, gilded, riso, brutal.

**The Rare Lavender Rule.** Roughly 10% of any screen. It marks the primary action, the current page, links, focus and live things. Never a fill behind a whole panel.

**The Meaning Color Rule.** Green is done. Amber is waiting on you. Red is failed. Gray is not started. Cue tints and the accent never stand in for these.

**The Hairline Rule.** Every border is `--ui-hair`. Inputs use `--ui-edge`. No other border color.

**The Theme Safety Rule.** A look value may not contain `; { } < > ! \ @import`, `url()` or unlisted CSS functions. Gradients, color functions, `var`, `calc`, `min`, `max`, `clamp`, `cubic-bezier` and `steps` are allowed.

## Typography

Source: `packages/ui/src/tailwind.css` (body, `--ui-font*`), `packages/ui/src/layout.tsx` (PAGE_TITLE, SECTION_TITLE, GROUP_LABEL).

- **Family:** Figtree Variable only, self-hosted by `@fontsource-variable/figtree`. No second display face. `--ui-font-display` equals `--ui-font` in the Wren look. Display weight is `--ui-display-weight` (500).
- **Body:** 15 px / 1.55, 400, tabular figures, antialiased.
- **Page title:** 22 px / 28 px, 650, tracking -0.02em (artifact `.atop h3`), balanced wrap. Same on phone.
- **Section title:** 16 px / 22 px, 600.
- **Group label:** 12.5 px / 16 px, 650, sentence case, ink-3. Case and tracking read `--ui-label-case` and `--ui-label-tracking` (none and 0), so a look can set capitals back. One constant: `GROUP_LABEL` in `layout.tsx`. The Map's column names keep small caps.
- **Rows and app text:** 14 px. Dense controls and bars: 13 px. Table heads: 12 px.
- **Lede (`ABOUT`):** 13.5 px ink-2 (artifact `.atop p`), one line, max 62ch.
- **Links:** underlined 1 px, offset 0.24em, ink-3, current color on hover.
- **Selection:** accent ground, on-accent text.

**The Tabular Rule.** Numbers use tabular figures in lists, counts, dates and tiles. Dates and counts read in ink-3 beside names.

**The Sentence Case Rule.** Buttons and group labels read in sentence case everywhere: weight 650, tracking 0. One rule, no per-page override. A look that wants capitals sets `--ui-button-case`, `--ui-label-case` and their tracking in its own preset.

**The Weight Carries Waiting Rule.** A row that waits on the viewer is semibold and ink. A row for info is regular ink-2. A page that names nothing waiting keeps medium.

## Layout

Source: `packages/ui/src/layout.tsx`, `shell.tsx`, `frame.tsx`, `display.ts`, `tailwind.css`.

- **Frame vars** are `--layout-*`, not `--ui-*`, so a client's look cannot set widths. Side 190 px, pages 208 px, row 40 px (snug 32), nav row 34 (snug 28), tab row 34 (snug 30), zoom 1.
- **Window:** `AppShell` is a grid `var(--layout-side) / minmax(0,1fr)` with a 54 px top bar. The app sits in one rounded window with a `--ui-frame` (10 px) margin on the canvas.
- **Main width:** 1240 px (`--ui-main-width`). Page padding is `18px clamp(12px, 2.5vw, 24px)` (artifact `.amain`); a wide page only drops the max width. Phone keeps 16 px. Lists use the full window width.
- **PageHeader:** wraps, items end, gap-x 24, gap-y 10, no rule, `mb-3.5` (artifact `.atop`).
- **Segmented control** (`frame.tsx`, `phone.tsx`; artifact `.seg`): fill ground, radius 10, 3 px padding, gap 2 px. Buttons 13.5 px, padding 6 px 12 px, radius `3px 9px 3px 9px`. The choice on screen is paper, ink, 600, `--ui-raise`. Focus is a 2 px focus outline, 1 px offset.
- **Section:** a framed panel with a band head strip. Framed sections stack 28 px apart. `plain` drops the frame; sibling plain sections stack 40 px apart.
- **Fieldset:** a frame whose legend is the head strip (group label). Body is a grid, gap 16, padding 16.
- **Display settings** (`display.ts`): sidebar and pages widths, rows roomy or snug, text small, normal or large (zooms `main` only), canvas frame on or off, counts on or off, motion full or less.
- **Resizers** sit on panel edges: drag, arrows, Enter folds, double-click resets. Sidebar 184 to 360 px (folds under 140). Pages 160 to 320 px (hides under 110).
- **Phone** is `max-width: 900px` (`PHONE` in `phone-shell.tsx`). The window goes flush (no margin, radius or shadow). Body ground is paper.

**The Window Rule.** The sidebar lists apps only. A closed app's pages show in a hover flyout (fine pointer only). The open app's pages sit in the pages column.

**The One Way Rule.** One component per job. If a page needs a list, table, card grid, action or field, it uses the kit's, never its own.

## Elevation & Depth

Source: `packages/ui/src/tailwind.css`.

| Token | Value | Use |
|---|---|---|
| `--ui-raise` | `0 0 0 1px rim, 0 1px 2px umbra 5%, 0 3px 10px -4px umbra 9%` | window, frames, cards |
| `--ui-float` | `0 0 0 1px rim, 0 4px 12px -4px umbra 14%, 0 18px 40px -16px umbra 26%` | popovers, menus, hover pops |
| `--ui-shadow` | `0 0 0 1px rim, 0 30px 80px -30px umbra 45%` | dialogs, side sheets, bottom sheets, record panel, toasts |

`rim` is hair at 45%. `umbra` is shade at 88% with accent. Flat content has no shadow; hairlines separate it.

**The Three Depths Rule.** Raise for what rests, float for what opens, shadow for what covers. No other shadow.

**The Scrim Rule.** Dialogs and bottom sheets sit on `--ui-scrim` with a light blur.

## Shapes

Source: `packages/ui/src/tailwind.css` (`--ui-radius`, `@theme` radius scale), `theme.tsx`.

- **Control** `--ui-radius` 6 px: inputs, menu items, and every control that is not a leaf.
- **Panel** `--ui-radius-panel` = min(2 x radius, radius + 4 px) = 10 px: popover bars, and the plain panel of a look with its own radius.
- **Sheet** `--ui-radius-sheet` = min(3 x radius, radius + 8 px) = 14 px: the window, dialogs, record panel, bottom sheets, popovers.
- Dots, step marks, the sheet grabber and the phone tab capsule stay fully round.
- A look that sets `--ui-radius` re-derives all three.

### The leaf

A leaf has two tight corners and two round ones: the top left and bottom right are the first value, the top right and bottom left the second. Four tokens, each a two-value `border-radius`:

| Token | Value | Use |
|---|---|---|
| `--ui-leaf-panel` | 6px 24px | panels, bands, cards (`FRAME`) |
| `--ui-leaf-button` | 6px 10px | buttons. A hint only: a button reads as a button first |
| `--ui-leaf-chip` | 3px 10px | tags, chips, pills |
| `--ui-leaf-nav` | 3px 12px | sidebar rows and page tabs |

A part writes `[border-radius:var(--ui-leaf-panel)]`. A head strip inside a panel uses `rounded-t-[inherit]`.

### The sweep

`Sweep` (`sweep.tsx`) draws a lavender line along the two round tips of a panel or band: the top right and the bottom left. The line fades out at both ends. A closed band shows it faint, and hover brings it up. An open band adds a fainter inner line. Nav rows with `aria-current` show a short sweep on the top right. Checks and avatars stay plain. `--ui-sweep` (1 on, 0 off) scales it, and it reads the `--ui-active` role, so a look re-colours it with the accent. The parent must be `relative`. Gradient ids come from `useId`.

**The Leaf Rule.** Panels, bands, buttons, chips and nav rows are leaves. The window, dialogs and sheets stay at 14 px. Nothing else gets a new corner size, except full-round dots.

## Components

Each family names its source. Shadcn parts in `components/ui` are owned copies on Base UI. Apps import from `@wren/ui`; icons come from `packages/ui/src/icons.tsx` (Lucide), never from lucide itself.

### Buttons

Source: `controls.tsx` (`Button`, `ButtonLink`, `Tag`), `components/ui/button.tsx`.

- **Tones:** `primary` (accent ground, on-accent text, a press edge under it), `secondary` (default; artifact `.btn.q`: paper ground, ink text, a 1 px hair ring and a 2 px hair edge, hover washes), `quiet` (ink-2 text, 14 px, underline).
- **Sizes:** `md` (14 px / 650, padding 9 x 16, artifact `.btn`), `sm` (13 px, padding 6 x 14, artifact `.pk .btn`), `dense` (h-8, px-3, 13 px medium, sentence case, secondary ring is hair, hover wash), `next` (h-9, px-4, 14 px semibold).
- **`next`** is the one action most pressed on a record or queue item. Only one per view.
- **Press edge:** the primary has `box-shadow: 0 3px 0 var(--ui-press-edge)` (`--ui-press-edge` is the accent 72% mixed with black; night sets `#7a69ad`). On press it sinks 3 px and the edge goes; the secondary does the same with its hair edge. It does not turn ink on hover. Buttons move on `--ui-spring`.
- **Feedback:** active scale 0.97 (quiet). Disabled opacity 40%. Focus ring 2 px `--ui-focus`, offset 2 px. `arrow` nudges 3 px on hover.
- **`busy`:** solid, `aria-busy`, disabled, the busy ring after the label (`Busy` in `busy.tsx`). Pass `busy` true or false on a button that can go busy, so the ring's slot is always there.
- **`done`:** its press just worked: a check draws in the ring's slot for 2.4 s (`useRun`'s `done`, `DONE_MS`). Then the toast with Undo.
- **Touch:** min height 44 px under `pointer-coarse`.
- **Tag:** status chip. `px-2.5 py-[3px]`, 12.5 px, semibold (artifact `.pt`), leaf-chip corners. Tones neutral, accent, warn, green. Optional 6 px dot.
- **Actions** (`action.tsx`): a reversible action runs at once and shows a toast with Undo for 10 s. Without undo it asks first. A blocked action shows turned off with its reason.

**The Undo Rule.** Undo, not confirm, for what can be reversed.

**The Next Rule.** One `next` button per record. Everything else is dense or quiet.

### Inputs

Source: `components/ui/input.tsx`, `textarea.tsx`, `fields.tsx`, `form.tsx`.

- Height 32 px (44 px coarse). Radius control. Border `--ui-edge`. Clear ground. `px-2.5`.
- Focus: border plus 1 px ring in `--ui-focus`; caret in focus color.
- Invalid: destructive border plus 3 px 20% ring.
- Disabled: opacity 50%.
- Coarse pointers: font 16 px (no iOS zoom), checkbox 22 px.
- Textareas grow (`field-sizing: content`, min 64 px).
- Checkboxes use `accent-color: ink`.

### Lists and records

Source: `records.tsx`, `list-bar.tsx`, `fields.tsx`, `card-grid.tsx`.

- **Row:** height `--layout-row` (48 px coarse), bottom hairline, hover `--ui-hover`, open row `--ui-fill`. Cells pad 12 px, truncate, ink-2. Dates ink-3 tabular. The title cell is a link with `TITLE_WEIGHT`.
- **Tiers:** waiting rows lead under **Needs you**, the rest under **For info**. A band row (`--ui-band`, h-8) with a count in ink-3. Tiers turn off when the list is grouped or sorted by hand.
- **Head row:** sticky, h-9, `--ui-band`, 12 px semibold ink-2, `--ui-edge` underline.
- **List bar** (`list-bar.tsx`): chips and pills h-8 (44 px coarse), 13 px, hair border, paper ground. Saved views are tabs with counts: 3 quick tabs, then up to 5 views, then More. A tab has a 2 px underline; on is ink, off is ink-2.
- **Record panel:** fixed right. Phone full width. At sm+: 560 px wide, floats 8 px in, sheet radius, `--ui-shadow`. Tabs have a 2 px underline. Facts use a two-column `dl` (150 px label).
- **Skeleton:** fill ground, leaf corners 3 and 8, a lavender tint sweeps across in 1.6 s (`.ui-skeleton::after`, artifact `.sk i`). Still under reduced or less motion.
- **Empty:** hair box (artifact `.stt`), corners 6 and 14, no ground, 13.5 px ink-2. It says what will fill the list.
- **Keys:** arrows and J/K move. A approve, E edit, S skip. `[` `]` panels. `?` lists keys. G then a letter goes to a page. Command-K opens the palette. Arrows are left to menus, listboxes, dialogs, sliders, tab lists and radio groups.

**The Needs You Rule.** What waits on the viewer leads, reads heavier, and counts in amber. What is for info reads quieter.

**The Number Link Rule.** Every number links to the rows behind it.

**The Nothing Apologizes Rule.** Empty and error states state facts and the next step. No sorry.

### Tables

Source: `table.tsx` (TanStack Table plus Virtual; `VIRTUAL_FROM` = 120 rows), `records.tsx`.

- `DataTable` looks: `plain` (13.5 px, hairline rows, ink-2 heads), `framed` (13 px, hair border, band head 12 px, `--ui-edge` head underline, fixed layout, first cell wraps, rest truncate in ink-2), `list` (13.5 px, h-9 heads, hover wash).
- `stack` turns each row into a card on phone: first cell on top, the rest as label and value (12 px ink-3 label).
- Long lists virtualize past 120 rows. A column totals footer is allowed.

### Cards

Source: `card-grid.tsx`, `layout.tsx` (`FRAME`).

- **Frame:** `FRAME` is leaf-panel corners, paper, `--ui-raise`, with a `Sweep`. `FRAME_HEAD` is a band strip: bottom hairline, `px-4 py-2.5`. `FRAME_BODY` is `p-4`.
- **Card grid:** `repeat(auto-fill, minmax(min(100%, 260px), 1fr))`, gap 12. Card is panel radius, hair border, paper, raise, 150 ms transitions. Selected: ink border plus 1 px ink ring. Hover: edge border.
- **Media:** wash ground, bottom hairline, aspect from `MEDIA_RATIO`.
- **Pick box:** 28 px (44 px coarse).
- **Rows or cards:** a two-icon segmented switch (`FormSwitch`), size 32. Past 40 rows the swap uses a view transition (260 ms group, 200 ms fades, `--ui-ease`). Less motion cross-fades.
- **Tiles** (`overview.tsx`): count tiles link to their rows.

### Navigation and shell

Source: `shell.tsx`, `frame.tsx`, `page-bar.tsx`, `launcher.tsx`, `palette.tsx`.

- **Top bar:** 54 px. App mark 30 px square on `--ui-fill`, control radius. App name 17 px display weight. Icon buttons 32 px (44 px coarse), clear, wash on hover, 150 ms.
- **Sidebar:** inside the window's card, not beside it. The card spans both columns. The sidebar takes `--layout-side` (190 px) at its left on `--ui-ground`, with a hairline right edge, padding 14 px top and 10 px sides, rows 2 px apart. The page is on paper. A phone has no sidebar ground.
- **Brand line:** the mark, 9 px, the workspace name at 16 px, 700.
- **Sidebar app row:** `--layout-nav-row` high, leaf-nav corners, 14 px regular ink-2, 9 px gap, 16 px icon at stroke 1.8. Current: `--ui-accent-tint`, semibold ink, and the short sweep on the top right.
- **Sidebar label ("Pinned"):** 12 px, 600, sentence case, ink-3. **Foot line:** "⌘K finds any app", 11.5 px, 600, ink-3, at the bottom.
- **Page tab:** `--layout-tab-row` high, leaf-nav corners, 14 px regular. Current: `--ui-accent-tint`, semibold, short sweep. Depth indents 8, 24, 36, 48 px.
- **Group heading:** the group label (12.5 px, 650, sentence case, ink-3) over a top hairline.
- **Count badge:** an accent pill (`--ui-primary`, text `--ui-on-accent`), 12 px bold, min width 20, full round. Folded sidebar shows a 6 px accent dot.
- **Hover text:** rests 400 ms, never on touch.
- **Palette:** command-K, `cmdk` in a dialog. Sheet radius.
- **Dialog:** sheet radius, `--ui-shadow`, 150 ms zoom 95% plus fade, `max-w-sm`. Head and foot are band strips with hairlines.
- **Side sheet:** 3/4 width up to `max-w-sm`, `--ui-shadow`, 200 ms.
- **Popover:** 288 px wide, sheet radius, `--ui-float`, 100 ms. Under 900 px it becomes a bottom sheet.
- **Toasts:** sonner on an ink ground with paper text, leaf corners, padding 10 x 14, 14 px; the action is a bold underline (artifact `.toast`).

### Phone

Source: `phone-shell.tsx`, `phone.tsx`, `phone-nav.ts`, `shell.tsx`.

- Breakpoint `max-width: 900px`. Touch targets 44 px via `pointer-coarse`.
- **Bar:** sticky, `--ui-glass`, blur 12 to 16 px, `env(safe-area-inset-*)`. iOS style: back chevron in `--ui-link`, compact title, a `Segmented` control for group pages.
- **Bottom tabs:** Home first, Apps last, three section tabs between. Labels 10.5 px medium. Current tab is semibold `--ui-active` with a 52 x 30 capsule in `--ui-accent-tint`. Count badge is a red pill (`--ui-bad`) at the icon's top right.
- **Apps sheet:** a grid of 56 px square marks by area. Badge is an amber chip. Opens at half height.
- **Bottom sheet:** detents, a 36 x 5 px grabber, drag down to close, `SPRING` curve `cubic-bezier(0.32, 0.72, 0, 1)`, 300 ms.
- **Rows:** `RowCard` with `SwipeRow`. Swipe right shows the first safe action; swipe left shows up to two, the destructive one last. A full swipe runs the far one. A touch within 24 px of the left edge belongs to back swipe.
- **Pull to refresh:** arms at 56 px, max 84 px.
- **Back:** edge swipe back works only in standalone (PWA). The back stack lives in `sessionStorage` key `wren:phone-walk`.
- Card stacks use `grid-cols-1` (Safari auto column issue).

**The Thumb Rule.** Every touch target is 44 px. Inputs are 16 px. Safe-area insets pad bars and sheets.

### Charts

Source: `charts/draw.tsx`, `components/ui/chart.tsx` (Recharts through shadcn chart parts; one lazy chunk).

- Colors come from `--chart-1` to `--chart-5` through `ChartContainer`, which sets `--color-<key>` (no `<style>` tag, so the CSP holds).
- **Spark:** a bar a day, 28 px high, under a tile number. A missing day keeps its slot.
- **Trend:** area, 1.5 px stroke, 12% fill, default height 220 px.
- **Bars:** 20 px bars, 36 px per row, labels 12 px ink-2 tabular.
- Axis text 11 px ink-2, ticks ink-3, grid lines hair. No animation.
- Tooltip: hair border, paper, 12 px, `--ui-shadow`, square color key.

### Motion

Source: `tailwind.css` (keyframes), `card-grid.tsx`, `controls.tsx`, `phone.tsx`.

- `--ui-ease`: `cubic-bezier(0.16, 1, 0.3, 1)`. Things that settle.
- `--ui-spring`: `cubic-bezier(0.2, 0.9, 0.25, 1.12)`. Things you press or open: buttons, the sweep's inner line.
- Hover and color: 100 to 200 ms. Dialogs 150 ms. Sheets 200 to 300 ms.
- `ui-changed` (1.4 s): a row that changed washes live-color 14% to clear.
- `ui-run-pulse` (1.6 s, opacity to 0.35), `ui-run-flow` (0.7 s linear), `ui-run-spark` (0.75 s): a live run.
- `ui-ring-spin` (0.8 s linear): the busy ring, the one mark for any wait.
- `ui-read` (900 ms): read-aloud bars.
- `ui-fade`: page fade in.
- `ui-ribbon-in` (0.9 s): the Map's ribbons grow in once on load (the real event: the data arrived); widths then ease on change. Off under reduced motion.

**The Real Event Rule.** Motion shows something that happened or is happening. No ambient motion, no entrance choreography.

**The Reduced Motion Rule.** Under the device setting or `data-motion="less"`, transforms, translates and scales drop. Opacity and color transitions stay, so feedback stays.

## Loading

Source: `designs/2026-10-20-design-language/design-language.src.html`, section 14 (`loading`). Rules only; the parts come later. A new token is allowed (for example a shimmer colour).

**Timing.** Under 150 ms, show nothing. Up to 1 s, show a skeleton in place, or the ring beside what refreshes. Past 1 s, add words. Past 10 s, show steps and say the person can leave.

| Kind | When | Looks like |
|---|---|---|
| Skeleton | first load of a page or sheet | Grey blocks in the shape of the content, with a slow lavender shimmer. The known header shows at once. |
| Refresh | data already shown reads again | The old data stays. The ring turns beside the panel or page title (`busy` on `Section` and `PageTitle`; `refreshing(load)`). A changed number fades in once. |
| Busy | a button or chip at work | The label stays and the slot is reserved: no width change. The ring turns beside it, then a check, then the toast with Undo. |
| Optimistic | a press with `optimistic` in a list | The row stays, washed, with the action's word and the ring ("Passed"), until the server answers. Then it leaves. A refusal brings it back with its words. A queue opens the next item at once. |
| Steps | any wait with stages | Each step names what it does and with what. The status line cross-fades and holds each line at least 600 ms, so it never flickers. Sources and targets fold in as small cards with the platform's own logo on its brand colour (`PlatformTile` in `marks.tsx`, from `simple-icons`; a plain site gets a globe), then stack into a deck with a count when the step is done. Past 10 s: a clock, and "you can leave". Done, it folds to one line that stays as the record and opens on a click (`Steps` in `steps.tsx`). One part for research, send, import, a video render and the map. |
| Stream | AI text | Text arrives as it comes, with a lavender caret and a "Drafting" chip with the ring. |

**The busy ring.** One shared part, `Busy` (`busy.tsx`), and one look (William, 10-21): a faint track (opacity 0.16) and one arc (dash 28 100, stroke 4.5, round cap) that turns, 0.8 s a turn. The ink is `--ui-live`; a primary button sets `--ui-busy-ink` to its own text. Sizes: 40 px in a modal (`BusyBox`), 18 px in the running step (it replaces the step's dot), 14 px elsewhere. Places: the running step, the optimistic chip, the pager count while the next page loads, a view tab whose rows still read, a button beside its label, a panel title on refresh, the AI chip, the ⌘K input (old results stay until new ones land), a modal, the phone's pull to refresh and a loading toast. No loading bars and no sweeps anywhere.

**Pagination.** A pager stays where it exists. Never remove a pager or swap it for infinite scroll. The next page loads in place at the same height: the rows on screen dim and the ring turns after the count, no jump.

**Not loading.** Empty, error and offline each look different from a wait. Error: one sentence and Retry. Offline: a banner, and writes queue.

**Reduced motion.** The shimmer and the draw-in go. The ring stops and shows its arc still. A check shows at once.

**The No Count Rule.** A number never counts up or jitters. A changed number fades in once (`ui-rise`, keyed by its value), on first load and on refresh.

**The No Spinner Rule.** Never a spinner in place of a label.

**The No Shift Rule.** A load never moves the layout. A skeleton keeps the final size.

**The Cache Rule.** A query lives in the query cache, not in a component. A page left while it loads still loads, and shows the data on return.

## Do's and Don'ts

### Do
- **Do** read `var(--ui-*)` tokens in every part. Take roles (`--ui-primary`, `--ui-active`, `--ui-link`, `--ui-focus`).
- **Do** use `Button`, `Tag`, `FRAME`, `Section`, `DataTable`, `Action` from `@wren/ui` before writing a new one.
- **Do** put numbers first and show them tabular.
- **Do** run a reversible action at once and offer Undo.
- **Do** keep a queue keyboard-first.
- **Do** state facts in empty states: what fills the list, and when.
- **Do** use human names, never slugs or ids, in visible copy.
- **Do** keep touch targets at 44 px and inputs at 16 px on coarse pointers.

### Don't
- **Don't** write a hex or a raw `rgb()` in a part. Add a token.
- **Don't** use amber, green or red for anything but their meaning.
- **Don't** add a shadow outside raise, float and shadow.
- **Don't** add a corner size outside the control, panel, sheet and leaf tokens.
- **Don't** set widths from a look. Frame vars are `--layout-*`.
- **Don't** give a client a showcase look, backdrop or grain.
- **Don't** let a skeleton sit past a second without words. Show the facts that exist.
- **Don't** add "Ask AI" buttons, favicon chips or ambient animation.
- **Don't** import `lucide-react`, `@base-ui/react`, `cmdk` or `sonner` in an app. Go through `@wren/ui` (`kit-door.test.ts` checks it).
- **Don't** add a second motif. The leaf and the sweep are the motif.
- **Don't** set uppercase in a part. Read `--ui-label-case` or `--ui-button-case`.
- **Don't** use a spinner in place of a label (see Loading).
