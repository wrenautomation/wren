# Brief A: tokens, case, leaf, sweep, night (wa-7oo.4)

Design: `designs/2026-10-20-design-language.md`, and its section "Decisions (planner, 2026-10-20)". Source of truth: `designs/2026-10-20-design-language/design-language.src.html`, sections 01, 02, 03 and 10. The artifact wins over the doc.

## Build

Every row of the section 10 table:

1. **Button case.** Sentence case everywhere, weight 650. Drop the uppercase default and the records override. One rule.
2. **Group labels.** Sentence case, 12.5 px, weight 650, ink-3. Map column names keep small caps tracking (B owns those).
3. **Leaf corners.** Add `--ui-leaf-panel` (6 24), `--ui-leaf-button` (6 10), `--ui-leaf-chip` (3 10), `--ui-leaf-nav` (3 12). Apply them in the shared parts (panel, button, chip or tag, nav item). Do not change `--ui-radius` or the derived panel and sheet radii. Window and sheet stay 14.
4. **Sweep.** One shared `Sweep` part (SVG, like `sw()` in the source): a lavender sweep on both round tips of panels and bands. An open band adds the fainter inner line. Checks and avatars stay plain.
5. **Night accent.** Night preset: accent `#a596d6`, on-accent `#15121f`, press edge `#7a69ad`. Update `theme.test.ts`. Keep the other night values.
6. **Primary press.** `--ui-press-edge` (day: accent 72% mixed with black). Primary button: `box-shadow: 0 3px 0 var(--ui-press-edge)`, sinks 3 px on press. No hover-to-ink.
7. **Display font.** Figtree only. Remove any Fraunces use.
8. **Line tokens.** `--ui-line-0` to `--ui-line-7`, day and night. 0 to 3 from the artifact: `#6a5a93 #2f8a80 #c0567f #3d78b8`, night `#a596d6 #5cc3b6 #e588ac #7fb0e6`. Pick 4 to 7: distinct hues, not amber (late) or red (bad), each at least 3:1 on paper, day and night. Add a contrast test.
9. **Map marks.** B builds them. Nothing here.

Motion tokens from the source, if not there yet: spring `cubic-bezier(.2,.9,.25,1.12)`, ease `cubic-bezier(.16,1,.3,1)`.

## Quiet Client Rule

Leaf corners, sentence case and the sweep are the Wren look and its night. A look that sets its own `radius` keeps plain corners: have `themeVars` (or the preset table) set the leaf tokens to its plain radius. A look that wanted uppercase sets it in its own preset now. Soft and editorial must look as they do today. A showcase look keeps its own case and corners. Add a test for each rule.

## Docs

`DESIGN.md`: update the front matter (typography, rounded, colours) and the prose. Rules to rewrite: "The Sentence Case Rule", "Three Corners Rule", the 11.5 px uppercase group heading, "Don't add a UI motif" and "No UI motif at present", primary "hover turns ink", night accent `#e8794a` in "Other looks". Add the leaf, the sweep, the press edge and the line tokens. Keep the Quiet Client Rule. ASD-STE100, no em dashes.

## Files you own

- `packages/ui/src/tailwind.css`, `theme.tsx`, `theme.test.ts`, `contrast.test.ts`, `DESIGN.md`
- Every user of `--ui-button-case` and `--ui-label-case`: `packages/ui/src/{frame,controls,rail,run,layout,records,shell,shop,launcher,sources,work}.tsx`, `apps/portal/web/src/modules/marketing/{tiktok,funnel,slides,fields}.tsx`, `apps/portal/web/src/modules/notes/{share,comments}.tsx`
- A new `packages/ui/src/sweep.tsx` and its story

Do not touch `packages/ui/src/metro/**` (builder B).

## Checks

- Stories: render, play, axe only. No pixel baselines. Add a Leaf and sweep story (panel, open band, buttons, chips, nav) in Wren day and night.
- While you build: `./scripts/gates.sh changed`, or `vitest run <file>`. Never `tsc`, `turbo` or `vitest` for the whole repo.
- Repo is public: synthetic data only.

## Commit

One commit (or a few) with `git commit -- <paths>`. Message ends with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PpzL4T1jZXndKhYDqy2SGC
```

Commit A in full before you start E. A and E share no commit. Do not push. Do not run the full gate; the planner runs it.

## Loading rules in DESIGN.md (William, 2026-10-20)

Source: artifact section 14 "Loading" (section id `loading`; CSS after `/* 14 loading */`) and the design doc's "UI soundness" section. Both are in `/Users/williamjin/Documents/wren_automation/wren/designs/` (commit 4bbaeaee, not yet on origin). Add a Loading section to DESIGN.md with these rules:

- Timing: nothing under 150 ms; skeleton or bar in place up to 1 s; words past 1 s; steps and "you can leave" past 10 s.
- Skeleton: first load of a page or sheet. Grey blocks in the shape of the content, slow lavender shimmer. The known header shows at once.
- Bar: refresh of data already shown. Old data stays. A 2 px lavender bar sweeps along the top of the panel. Numbers tick to the new value.
- Busy edge: a button's own action. The label and width stay. A bar fills along the bottom edge, then a check, then the toast with Undo.
- Steps: a job over 10 s. Each step with its state, and a line that says the person can leave.
- Stream: AI text arrives as it comes, with a lavender caret and a "Drafting" chip.
- Not loading: empty, error and offline each look different from a wait. Error: one sentence and Retry. Offline: a banner; writes queue.
- Reduced motion: shimmer and draw-in go; bars still move.
- Never a spinner in place of a label. Never a layout shift. A query lives in the cache, so a page left while it loads still loads on return.

Docs only in A. No new loading parts unless one is a token (for example a shimmer colour).
