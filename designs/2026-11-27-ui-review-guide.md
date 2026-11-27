# UI review guide (11-27)

For William: what to open, in order, and what each stop asks of you. Storybook runs at http://localhost:61000 (the sidecar keeps it up). Each link opens one story. Open it, then set the toolbar to 390 and to dark where a stop says so.

Detail and commits for every fix: `designs/2026-11-26-ui-audit-ledger.md`.

## 1. Decisions only you can make

Open these first. Each one waits on your call.

| # | Open | Decide |
|---|---|---|
| 1 | [Shell: Today](http://localhost:61000/?path=/story/redesign-shell--today), [Today Night](http://localhost:61000/?path=/story/redesign-shell--today-night), [Under More](http://localhost:61000/?path=/story/redesign-shell--under-more), [Client Keeps Apps](http://localhost:61000/?path=/story/redesign-shell--client-keeps-apps) | D2 nav: top pills (WA-1456). Keep, or pick another nav |
| 2 | [Anton: Shut](http://localhost:61000/?path=/story/redesign-anton--shut), [Open Chat](http://localhost:61000/?path=/story/redesign-anton--open-chat), [Open Empty](http://localhost:61000/?path=/story/redesign-anton--open-empty) | Anton docked (WA-1457). You said "the agent view needs work": what to change |
| 3 | [Icons: In Use](http://localhost:61000/?path=/story/brand-icons--in-use), [Side By Side](http://localhost:61000/?path=/story/brand-icons--side-by-side) | Anton's circle mark and the SMS icon (WA-1460) |
| 4 | [Content: Studio](http://localhost:61000/?path=/story/app-wren-campaigns-content--studio) | Column type icons in table heads: keep (Notion does this) or drop (R9.11) |

## 2. What you agreed: check we built it

| Part | You agreed | Open |
|---|---|---|
| Look | Raycast light: mostly white, soft greys, the L5 Notion feel | any story below, light and dark |
| Aerie Tasks | Backlog.md copy; Board as v116; List with a right pane; no agent column split; subtle motion | [Board](http://localhost:61000/?path=/story/redesign-aerie-tasks--board), [List No Pick](http://localhost:61000/?path=/story/redesign-aerie-tasks--list-no-pick), [List Picked](http://localhost:61000/?path=/story/redesign-aerie-tasks--list-picked), [Anton Open](http://localhost:61000/?path=/story/redesign-aerie-tasks--anton-open) |
| To approve | "a bunch of bento cards is fine" | [Approve Cards](http://localhost:61000/?path=/story/app-wren-today-approve-and-messages--approve-cards) |
| Batches | more actions at the top level; an open variant "looks good" | [Default](http://localhost:61000/?path=/story/app-vireo-batches--default), [Worst Case](http://localhost:61000/?path=/story/app-vireo-batches--worst-case), [Phone](http://localhost:61000/?path=/story/app-vireo-batches--phone) |
| Icons | swap B, stroke 1.6 (WA-1464) | [In Use](http://localhost:61000/?path=/story/brand-icons--in-use) |
| Hovers | the hover triangle: no flicker as the cursor moves onto a menu | any row menu or nav flyout: move the cursor across at an angle |

## 3. Made by us, not yet agreed: critique these

| Part | Open | What changed in this loop |
|---|---|---|
| Lists and tables | [Records: Worst Case](http://localhost:61000/?path=/story/records--worst-case), [Panel Open](http://localhost:61000/?path=/story/records--panel-open), [Table: Worst Case](http://localhost:61000/?path=/story/table--worst-case) | No dots, avatars or rank circles at the left. Heads stay on one line. Money first when narrow |
| List bar | [Worst Case](http://localhost:61000/?path=/story/list-bar--worst-case), [Filtering](http://localhost:61000/?path=/story/list-bar--filtering) | At 390, a view tab that does not fit whole moves under More. A cut row fades at its edge |
| Today | [Overview](http://localhost:61000/?path=/story/app-wren-today-overview--default), [Phone](http://localhost:61000/?path=/story/app-wren-today-overview--phone), [Messages](http://localhost:61000/?path=/story/app-wren-today-approve-and-messages--messages), [Calendar](http://localhost:61000/?path=/story/app-wren-today-calendar--default) | Ages say a word ("waiting 43 days"). Stat cards are tint only. No calendar stripe |
| Canon | [Outliers](http://localhost:61000/?path=/story/app-wren-canon-outliers--outliers), [None Scored](http://localhost:61000/?path=/story/app-wren-canon-outliers--none-scored), [Explorer › Canon](http://localhost:61000/?path=/story/app-wren-explorer-canon--default) | No photo = grey blank. Empty states name no command |
| Studio | [Projects](http://localhost:61000/?path=/story/app-wren-studio--projects), [Compose](http://localhost:61000/?path=/story/app-wren-campaigns-content--studio-compose) | Compose "Fits" has a check |
| Weaver | [Graph](http://localhost:61000/?path=/story/app-weaver-research--graph), [References](http://localhost:61000/?path=/story/app-weaver-research--references) | Site icons from gstatic; a site with no icon shows its format glyph |
| Graph map | [Open Box](http://localhost:61000/?path=/story/graph-map--open-box), [Pick Line](http://localhost:61000/?path=/story/graph-map--pick-line) | The glide copy takes no focus |
| Agent chat | [Work](http://localhost:61000/?path=/story/app-wren-agent-chat--work) | No mono outside a terminal block |
| Client | [Today](http://localhost:61000/?path=/story/app-client-today--default), [People › Lists](http://localhost:61000/?path=/story/app-client-people-lists--default), [Import](http://localhost:61000/?path=/story/app-client-people-lists--import) | Import's phone view gets its phone field |

## 4. Known, not fixed

- Client nav shows "Today" twice at 390: the sidebar and the phone tab bar.
- Engage's reply box placeholder is cut at 390.
- Campaigns area tabs at 390 cut "Inboxes" (it fades, and it scrolls).
- Four sends have no page since the 11-04 shell cut: SMS reply, and message, invite and follow a person from People. The Worker still takes them. Bring the pages back, or retire the routes.
- Speed and size (ledger, "Performance rounds"): sidebar counts p50 526 ms. Options: count in SQL, share loaders (code), or Lambda 1024 → 1769 MB (costs money). The first page loads 1.14 MB gzip: lazy pages or a lazy agent chat would cut most of it.

## 5. State of main

- Portal unit tests: all green (9f5bcf220).
- Story tests: graph/map fixed (f48645a08). `confirm › Answers` and two metro stories fail on some runs under load only.
