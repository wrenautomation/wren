# Briefs B1 to B7 and R5: every hand-drawn list moves to `Rows`

Design: `designs/2026-10-21-crm-rows-everywhere.md` (parts 4 and 5). Needs R1 (`packages/ui/src/rows.tsx`) on branch `rows`. Beads `wa-7oo.13`, `wa-7oo.15`.

Each batch is one builder, one worktree `~/worktrees/wren-rows-b<N>`, branch `rows-b<N>`, from branch `rows`. Effort high (B5 xhigh). One builder at a time.


## Artifact check (William 10-21: the artifact is the reference)

Built page: `designs/2026-10-20-design-language/design-language.html` (artifact SuhuZqr8). Open it in a browser. Your sections: `#inbox` panels F1 and F2 for every list you move; `#parts` and `#app` for the page around it; `#loading` for first loads. Each batch's commit names the sections it checked. Before hand-off, put each section and your story shot side by side, at 1280 and 390, light and dark. Fix each difference. List any difference you leave, with the reason. The busy ring goes on buttons only, never beside a title. A first load uses the shaped skeleton (`Loading`), never `BusyBox`.

## The rule for each file

- **LIST** (rows of things, each one a record or an item): draw it with `Rows`. Delete the hand row code. Keep what the rows do: links, actions, pick, drag, inline edit.
- **FACTS** (a small fixed key and value block): draw it with `FactsTable`, or leave a `dl` when it is a label and value list inside a card.
- **NOT a list** (prose bullets, steps, a thread, a menu, chips, a calendar, a kanban, an editor's field list): leave it. Note it in the commit when the inventory said LIST and you found it is not.
- A card grid that is a list of records (`wren/made.tsx`, `wren/automations.tsx`, `learn/sources.tsx`): move it to `Rows`. A gallery of posters or covers stays.
- A list in a popover (`learn/bell.tsx`) uses `Rows` with no header and no gutter.
- Every action goes through the page's existing write path (`call`, `useRun`, `useHeld`). No new write path. Test tab-away, races and grouping where a row acts.

Owned elsewhere, do not touch: `modules/marketing/studio.tsx` and `modules/marketing/siblings.tsx` (the Studio planner), everything under `map/` and `packages/ui/src/metro/` (out of scope), `today.tsx` only if the Studio planner says it is theirs (ask the planner).

Paths below are under `apps/portal/web/src/modules/` unless they start with `apps/`.

Inventory (2026-10-21): 51 files draw a hand list, about 2,400 lines. About 8 small blocks are FACTS. The rest of the about 120 files that hit the search are not lists.

## B1: Today and Learn feeds

`apps/portal/web/src/today.tsx` (the three digests: needs you, quota lines, moves; `AppsByArea` is a menu, NOT), `learn/bell.tsx`, `learn/home.tsx`, `learn/learn.tsx`, `learn/today.tsx`, `learn/find.tsx`, `learn/drive.tsx` (`CompactRow`: the compact view becomes a `Rows` density), `learn/sources.tsx`. About 480 lines.

## B2: Notes and Calendar

`notes/home.tsx`, `notes/mentions.tsx`, `notes/backlinks.tsx`, `notes/versions.tsx`, `notes/share.tsx`, `notes/board-settings.tsx`, `calendar/schedule.tsx` (the agenda only; the week and month grids are NOT). About 230 lines.

## B3: Wren and settings

`wren/ask.tsx`, `wren/dossier.tsx`, `wren/made.tsx`, `wren/health.tsx` (at-risk and urgent lists; Parts is FACTS), `wren/executions.tsx`, `wren/automations.tsx` (cards), `sites/split.tsx` (variants, Retire), `settings/Guide.tsx`, `settings/Systems.tsx`. About 320 lines.

## B4: Account, access and work

`account/AiTools.tsx`, `account/People.tsx`, `account/Overview.tsx`, `account/Now.tsx`, `account/summary.tsx`, `account/Mail.tsx` (mailboxes; `Item` is a checklist, NOT), `account/Connectors.tsx`, `account/Social.tsx`, `account/social-bits.tsx`, `account/Webhooks.tsx` (hooks and deliveries; tries is NOT), `access/PersonAccess.tsx`, `work/Feedback.tsx`. FACTS: `account/Vendors.tsx`, `account/billing.tsx`. About 420 lines.

## B5: rows with inline edit or order (xhigh)

`account/Fields.tsx` (Up and Down, inline edit, Archive), `marketing/facts.tsx` (drag order, inline edit, History with Undo), `marketing/plan.tsx` (pieces and goals, inline goal edit), `library/templates.tsx` (versions: compare pick, Restore). About 380 lines. `Rows` may need a row edit slot (a box line under a row, as `List`'s reply box rows) and a drag handle. Add them to `rows.tsx` once, not per page. Text boxes keep `useEdit`, `useSaved` or `useKeptForm`.

## B6: Marketing read and act

`marketing/pieces.tsx` (branches, what happened), `marketing/reports.tsx` (sends; its `dl` is FACTS), `marketing/feed.tsx`, `marketing/videos.tsx` (cut proposals, promo drafts, Shorts suggestions, thumbnails; steps, checks, pass, chapters and moments are NOT). FACTS: `marketing/analytics.tsx`. About 300 lines.

## B7: Marketplace and People

`marketplace/Catalog.tsx`, `marketplace/Installed.tsx`, `marketplace/Mods.tsx`, `marketplace/Template.tsx` (parts; plan and copy are FACTS), `people/research.tsx` (Keep, Drop), `people/channels.tsx` (the people list at about line 378). FACTS: `reactivation/keep.tsx`. About 230 lines.

## R5: remove what is left and guard it

After B1 to B7:

- Delete the `LIST` row style in `work/bits.tsx` and any per-page row helper left with no user.
- `scripts/libs-guard.mjs`: in `apps/portal/web/src`, a `<ul>` or `<ol>` with ruled rows (`divide-y`, or `[&>li]:border-b`, or `<li` with `border-b`) fails unless the line has `rows-ok: <reason>`. Mark each NOT list that trips it with its reason. `map/` is excused.
- Update the design doc's part 4 with the files that stayed and why.

## Tests for each batch

- Each moved page keeps its story, or gets one on `wren-stories` (port 61001, MSW, sample data). The story runner gives light, dark and phone.
- A page whose rows act: a play test that runs the action and sees the result, and one that clicks two rows fast.
- `./scripts/gates.sh ui` while you build, `changed` before each commit. Never scan or screenshot the live portal.

## Commits

One commit per file or a few small files. `git commit -- <paths>`. Trailers: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01PpzL4T1jZXndKhYDqy2SGC`. Do not push. Report the shas and each file you did not move, with why.
