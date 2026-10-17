---
name: Wren Portal
description: The look of the Wren portal and its client products. Soft corners, warm paper, one lavender accent, dense calm lists. Derived from packages/ui as shipped.
colors:
  canvas: "#f3f1ec"
  paper: "#ffffff"
  ink: "#0e0e0e"
  ink-2: "#56564f"
  ink-3: "#63645e"
  accent: "#6a5a93"
  on-accent: "#faf7f2"
  good: "#17803d"
  good-ink: "#136b33"
  warn: "#b7791f"
  warn-ink: "#895911"
  bad: "#c31c15"
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
    fontSize: 12px
    fontWeight: 600
    lineHeight: 16px
    letterSpacing: 0.09em
rounded:
  control: 6px
  panel: 10px
  sheet: 14px
  full: 9999px
spacing:
  frame: 10px
  row: 40px
  row-snug: 32px
  nav-row: 32px
  tab-row: 34px
  side: 224px
  pages: 208px
  main: 1240px
  touch: 44px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.dense}"
    rounded: "{rounded.control}"
    height: 32px
    padding: 0 12px
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.dense}"
    rounded: "{rounded.control}"
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
    rounded: "{rounded.panel}"
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
- Soft corners at three sizes (6, 10, 14 px). Derived from one token.
- One accent, Smoky Lavender, used rarely and only through role tokens.
- Figtree Variable at 13 to 15 px for the app. Tabular figures everywhere.
- Hairline borders. Raised surfaces use a ring plus a soft shadow.
- Outcome first. Every number links to its rows. Empty states say what fills them.
- Motion marks real events: a row changed, a run is live, a button is busy.
- No UI motif at present. The wing mark and `--ui-motif` were removed on 2026-10-14. A motif is planned as its own pass.

**The Source Rule.** Tokens live in `packages/ui/src/tailwind.css` (`:root`) and are overridden per look by `packages/ui/src/theme.tsx`. A part reads `var(--ui-*)`. It never writes a hex.

**The Quiet Client Rule.** Clients get the plain presets only. Showcase looks, backdrops, grain and lift belong to Wren's own portal. `setLook` refuses them for a client.

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
- **Waiting Amber** (`--ui-warn`, ink `--ui-warn-ink`): waiting on you. Only for things that need a person, such as the sidebar count.
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
| `--ui-ground` | canvas 45% over paper | the window's page area |

### Role tokens
`--ui-primary`, `--ui-active`, `--ui-link`, `--ui-focus` and `--ui-live` all resolve to the accent. Parts take a role, never `--ui-accent` itself. A look can re-point one role.

### Cues
`--ui-cue-1` to `--ui-cue-8`: `#6b84b8 #4f9a8f #9a8fc4 #b77a62 #a86f9e #5f97b8 #8f9a5c #b8738a`. They tell kinds of things apart (`TintSwatch`, `tintWash` in `marks.tsx`). They never mean status.

### Chart
`--chart-1` accent, `--chart-2` ink-2, `--chart-3` good, `--chart-4` accent 45% over paper, `--chart-5` ink-3.

### Other looks (`theme.tsx` PRESETS)
- **night** (dark): canvas `#0d0d0c`, paper `#171716`, ink `#f2f0ea`, accent `#e8794a`.
- **soft**: canvas `#eef1f6`, accent `#3552d4`, rounded system font, radius 12 px, no uppercase.
- **editorial**: canvas `#f4f1ea`, paper `#fffdf8`, accent `#1d5a45`, serif display, radius frame 0.
- Showcase (Wren only): aurora, synthwave, terminal, gilded, riso, brutal.

**The Rare Lavender Rule.** Roughly 10% of any screen. It marks the primary action, the current page, links, focus and live things. Never a fill behind a whole panel.

**The Meaning Color Rule.** Green is done. Amber is waiting on you. Red is failed. Gray is not started. Cue tints and the accent never stand in for these.

**The Hairline Rule.** Every border is `--ui-hair`. Inputs use `--ui-edge`. No other border color.

**The Theme Safety Rule.** A look value may not contain `; { } < > ! \ @import`, `url()` or unlisted CSS functions. Gradients, color functions, `var`, `calc`, `min`, `max`, `clamp`, `cubic-bezier` and `steps` are allowed.

## Typography

Source: `packages/ui/src/tailwind.css` (body, `--ui-font*`), `packages/ui/src/layout.tsx` (PAGE_TITLE, SECTION_TITLE, GROUP_LABEL).

- **Family:** Figtree Variable, self-hosted by `@fontsource-variable/figtree`. `--ui-font-display` equals `--ui-font` in the Wren look. Display weight is `--ui-display-weight` (500).
- **Body:** 15 px / 1.55, 400, tabular figures, antialiased.
- **Page title:** 28 px / 34 px, 600, tracking -0.022em, balanced wrap. Phone: 22 px / 28 px.
- **Section title:** 16 px / 22 px, 600.
- **Group label:** 12 px / 16 px, 600, uppercase, tracking `--ui-label-tracking` (0.09em), ink-2. The case and tracking read `--ui-label-case`, so a look can drop uppercase.
- **Rows and app text:** 14 px. Dense controls and bars: 13 px. Table heads: 12 px.
- **Lede (`ABOUT`):** 14 px ink-2, one line, max 62ch.
- **Links:** underlined 1 px, offset 0.24em, ink-3, current color on hover.
- **Selection:** accent ground, on-accent text.

**The Tabular Rule.** Numbers use tabular figures in lists, counts, dates and tiles. Dates and counts read in ink-3 beside names.

**The Sentence Case Rule.** The token default for buttons is uppercase, 13.5 px, 600, tracking 0.08em. That suits marketing-like surfaces. Record templates (`ROOT` in `records.tsx`) set `--ui-button-case: none`, tracking 0 and weight 500, so app buttons read in sentence case. Uppercase stays for group labels.

**The Weight Carries Waiting Rule.** A row that waits on the viewer is semibold and ink. A row for info is regular ink-2. A page that names nothing waiting keeps medium.

## Layout

Source: `packages/ui/src/layout.tsx`, `shell.tsx`, `frame.tsx`, `display.ts`, `tailwind.css`.

- **Frame vars** are `--layout-*`, not `--ui-*`, so a client's look cannot set widths. Side 224 px, pages 208 px, row 40 px (snug 32), nav row 32 (snug 28), tab row 34 (snug 30), zoom 1.
- **Window:** `AppShell` is a grid `var(--layout-side) / minmax(0,1fr)` with a 54 px top bar. The app sits in one rounded window with a `--ui-frame` (10 px) margin on the canvas.
- **Main width:** 1240 px (`--ui-main-width`). Wide pages use full width with `px-8`. Lists use the full window width.
- **PageHeader:** wraps, items end, gap-x 24, gap-y 12, bottom hairline, `pb-5`, `mb-7`.
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

- **Control** `--ui-radius` 6 px: buttons, inputs, chips, tags, menu items, nav rows.
- **Panel** `--ui-radius-panel` = min(2 x radius, radius + 4 px) = 10 px: frames, cards, popover bars.
- **Sheet** `--ui-radius-sheet` = min(3 x radius, radius + 8 px) = 14 px: the window, dialogs, record panel, bottom sheets, popovers.
- Dots, step marks, the sheet grabber and the phone tab capsule stay fully round.
- A look that sets `--ui-radius` re-derives all three.

**The Three Corners Rule.** Use control, panel or sheet. Nothing else rounds, except full-round dots.

## Components

Each family names its source. Shadcn parts in `components/ui` are owned copies on Base UI. Apps import from `@wren/ui`; icons come from `packages/ui/src/icons.tsx` (Lucide), never from lucide itself.

### Buttons

Source: `controls.tsx` (`Button`, `ButtonLink`, `Tag`), `components/ui/button.tsx`.

- **Tones:** `primary` (accent ground, on-accent text, hover turns ink), `secondary` (default; clear ground, 1 px ink inset ring, hover fills ink), `quiet` (ink-2 text, 14 px, underline).
- **Sizes:** `md`, `sm` (12.5 px), `dense` (h-8, px-3, 13 px medium, sentence case, secondary ring is hair, hover wash), `next` (h-9, px-4, 14 px semibold).
- **`next`** is the one action most pressed on a record or queue item. Only one per view.
- **Feedback:** active scale 0.97. Disabled opacity 40%. Focus ring 2 px `--ui-focus`, offset 2 px. `arrow` nudges 3 px on hover.
- **`busy`:** solid, `aria-busy`, disabled, a 2 px bar under the label.
- **Touch:** min height 44 px under `pointer-coarse`.
- **Tag:** status chip. `px-[9px] py-0.5`, 12 px, semibold, radius control. Tones neutral, accent, warn, green. Optional 6 px dot.
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
- **Skeleton:** `animate-pulse`, wash ground, h-10 lines.
- **Empty:** dashed `--ui-edge` box, wash ground, 14 px ink-2. It says what will fill the list.
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

- **Frame:** `FRAME` is panel radius, paper, `--ui-raise`. `FRAME_HEAD` is a band strip: bottom hairline, `px-4 py-2.5`. `FRAME_BODY` is `p-4`.
- **Card grid:** `repeat(auto-fill, minmax(min(100%, 260px), 1fr))`, gap 12. Card is panel radius, hair border, paper, raise, 150 ms transitions. Selected: ink border plus 1 px ink ring. Hover: edge border.
- **Media:** wash ground, bottom hairline, aspect from `MEDIA_RATIO`.
- **Pick box:** 28 px (44 px coarse).
- **Rows or cards:** a two-icon segmented switch (`FormSwitch`), size 32. Past 40 rows the swap uses a view transition (260 ms group, 200 ms fades, `--ui-ease`). Less motion cross-fades.
- **Tiles** (`overview.tsx`): count tiles link to their rows.

### Navigation and shell

Source: `shell.tsx`, `frame.tsx`, `page-bar.tsx`, `launcher.tsx`, `palette.tsx`.

- **Top bar:** 54 px. App mark 30 px square on `--ui-fill`, control radius. App name 17 px display weight. Icon buttons 32 px (44 px coarse), clear, wash on hover, 150 ms.
- **Sidebar app row:** `--layout-nav-row` high, 14 px medium ink-2. Current: paper ground, semibold, inset hair plus a 3 px left bar in `--ui-active`.
- **Page tab:** `--layout-tab-row` high, 14 px medium. Current: `--ui-accent-wash`, semibold, 3 px left bar. Depth indents 10, 24, 36, 48 px.
- **Group heading:** 11.5 px, semibold, group-label tracking, uppercase, ink-2, top hairline.
- **Count badge:** amber (`--ui-warn-tint`, `--ui-warn-ink`), 12 px semibold, min width 20. Folded sidebar shows a 6 px amber dot.
- **Hover text:** rests 400 ms, never on touch.
- **Palette:** command-K, `cmdk` in a dialog. Sheet radius.
- **Dialog:** sheet radius, `--ui-shadow`, 150 ms zoom 95% plus fade, `max-w-sm`. Head and foot are band strips with hairlines.
- **Side sheet:** 3/4 width up to `max-w-sm`, `--ui-shadow`, 200 ms.
- **Popover:** 288 px wide, sheet radius, `--ui-float`, 100 ms. Under 900 px it becomes a bottom sheet.
- **Toasts:** sonner, themed from tokens.

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

- `--ui-ease`: `cubic-bezier(0.16, 1, 0.3, 1)`.
- Hover and color: 100 to 200 ms. Dialogs 150 ms. Sheets 200 to 300 ms.
- `ui-changed` (1.4 s): a row that changed washes live-color 14% to clear.
- `ui-run-pulse` (1.6 s, opacity to 0.35), `ui-run-flow` (0.7 s linear), `ui-run-spark` (0.75 s): a live run.
- `ui-busy` (1.2 s): the bar under a busy button.
- `ui-read` (900 ms): read-aloud bars.
- `ui-fade`: page fade in.

**The Real Event Rule.** Motion shows something that happened or is happening. No ambient motion, no entrance choreography.

**The Reduced Motion Rule.** Under the device setting or `data-motion="less"`, transforms, translates and scales drop. Opacity and color transitions stay, so feedback stays.

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
- **Don't** add a corner size outside 6, 10 and 14 px.
- **Don't** set widths from a look. Frame vars are `--layout-*`.
- **Don't** give a client a showcase look, backdrop or grain.
- **Don't** show a skeleton that sits for seconds. Show the facts that exist.
- **Don't** add "Ask AI" buttons, favicon chips or ambient animation.
- **Don't** import `lucide-react`, `@base-ui/react`, `cmdk` or `sonner` in an app. Go through `@wren/ui` (`kit-door.test.ts` checks it).
- **Don't** add a UI motif here. It is planned as its own pass.
