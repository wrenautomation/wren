# Brief L: make the shipped UI look match the artifact

William 2026-10-21: "some of the UI didn't follow the source of truth artifact exactly like the sidebar, UI look. this is not related to functionality just UI. fix asap"

Source of truth: `designs/2026-10-20-design-language/design-language.src.html` (artifact SuhuZqr8). Its CSS is at the top of the file (lines 1 to 335). Decisions: `designs/2026-10-20-design-language.md` (token names, leaf corners, line colours).

Worktree `~/worktrees/wren-look`, branch `look`, from branch `rows`. Effort high. Look only: no change to what a part does, its routes, its data or its props. Other builders work in `packages/ui/src/{table,records,row-acts,fields,marks,overview}.tsx`, a new `rows.tsx`, and the inbox module. Do not touch those files. Do not touch the Map or Studio either: `packages/ui/src/metro/`, `apps/portal/web/src/map/`, the Map page, `apps/portal/web/src/modules/marketing/studio.tsx` and the draft composers under `modules/marketing`. The Studio and Map planner owns them. If a diff lives there, list it in your report and leave it.

Read first: the artifact CSS (lines 1 to 335) and its sections `app` (line 462) and `prop` (line 608); `packages/ui/src/shell.tsx`, `packages/ui/src/phone-shell.tsx`, `packages/ui/src/shell.stories.tsx`, `packages/ui/src/tailwind.css` (tokens).


## Artifact check (William 10-21: the artifact is the reference)

Built page: `designs/2026-10-20-design-language/design-language.html` (artifact SuhuZqr8). Open it in a browser. Your sections: all of them: `#tokens`, `#parts`, `#app`, `#prop` (E sidebar, F focus), `#loading`, `#inbox`. Before hand-off, put each section and your story shot side by side, at 1280 and 390, light and dark. Fix each difference. List any difference you leave, with the reason. The busy ring goes on buttons only, never beside a title. A first load uses the shaped skeleton (`Loading`), never `BusyBox`.

## Work

1. The sidebar first. Match `.side`, `.brand`, `.nav`, `.nav[aria-current]` (tint ground, weight 600, the accent corner arc `::after` with its mask), `.nav .n` (the count pill), `.nav svg` (16px, stroke 1.8), `.nl` (the "Pinned" label), `.side .kbd` (the "⌘K finds any app" line at the foot). Width 190px. Ground `color-mix(in srgb, var(--ui-canvas) 55%, var(--ui-paper))`, a hairline right edge, padding 14px 10px, gap 2px. Leaf corners from the tokens (`--ui-leaf-nav` is 3 12).
2. Then the page frame around it: `.amain` padding, `.atop` (title 22px, letter spacing -0.02em, the line under it 13.5px ink-2), `.seg` (the segmented control: fill ground, radius 10, 3px pad, a pressed button on paper with weight 600 and `--raise`).
3. Then every other surface the artifact draws that is already built in the kit or the portal (tokens, buttons, chips, panels, sheets, focus rings, skeletons in section `loading`). Compare each one to its CSS rule. Fix the gaps.
4. Night: each fix holds in dark mode with the artifact's night values.
5. The phone: the artifact hides the side at 760px. Keep the kit's phone shell (bottom tabs) as it is unless it breaks a rule in section `prop` ("Phone: Map, Inbox, People, first pin. Four tabs. Admin sits under More.").

Use the tokens (`--ui-*`). Never hard-code a colour the tokens have. Use the existing icon set; draw an icon by hand only if the kit lacks it, and then add it to `icons.tsx`.

## Check

- Local Storybook only (`packages/ui` stories, and the portal page stories on port 61001 with MSW). Never scan or screenshot the live portal.
- Put the artifact page and the story side by side in a local browser at 1280 light and 390 dark, and look. No pixel baselines (story tests are render, play, axe).
- `./scripts/gates.sh ui` while you build. `./scripts/gates.sh changed` before each commit. Never call `tsc`, `turbo` or `vitest` for the whole repo.
- Stop Storybook and every process you start before you report.

## Report

A list: each gap found, as "artifact rule → file:line, what changed". Then what you left and why.

## Commits

Small commits, one surface each. `git commit -- <paths>`. Trailers: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01PpzL4T1jZXndKhYDqy2SGC`. Do not push.
