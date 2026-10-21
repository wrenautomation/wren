# Artifact match (2026-10-21)

William: the UI must match the design language artifact exactly. "Close" is a fail. The artifact (`designs/2026-10-20-design-language/`) is the source of truth, and it changes as he learns. The code follows it.

## Why we drift

1. The portal tokens differ from the artifact (`--ui-hair` 22% against 11%, `--ui-fill` 6% against 5%, night ink-3).
2. Builders write CSS by eye from a shot, so each value drifts a little.
3. No check compares the two. Story tests check render, play and axe only.

## Target state

1. **Tokens are the artifact's.** `packages/ui/src/tailwind.css` takes each artifact token value as it is (day and night). The `--ui-*` names stay; their values come from the artifact. A token the artifact does not have stays only if a part needs it, with a comment that names the part. William said yes to 11% hair and 5% fill on 10-21. If an artifact value fails the contrast test (night ink-3 was lightened for it), the artifact is wrong: report it to William and the artifact session. Do not keep the old value without a word.
2. **Parts port the artifact CSS.** Each part in `packages/ui` takes its values from the artifact rule for that part: padding, gap, radius, border, font size and weight, colours, hover and selected. No value made up by hand.
3. **A match check in the gate.** It is the rule that keeps 1 and 2 true.
   - A map file (`packages/ui/match/parts.ts`) lists pairs: an artifact selector (section id + CSS selector in `design-language.html`) and a story id + selector for the same part, in day and night.
   - A Playwright script opens the artifact page and the story (local Storybook on MSW), reads `getComputedStyle` for a fixed property list, and compares. Properties: padding, margin between siblings (gap), border width, style and colour, border radius, background colour, colour, font family, size, weight, line height, letter spacing, box shadow, height of a row.
   - Colours compare after resolve to rgba, with a small tolerance for rounding. Lengths compare exactly.
   - Any difference fails, and the output names the part, the property and both values.
   - It reads computed styles, never pixels. The no-pixel-compare rule holds.
   - It runs in `gates.sh ui` and in CI's story job.
   - One artifact node per part. The artifact draws some parts in several sections (`#parts`, `#scen`, `#app`, `#inbox`) and the values can differ. The map pins one node, and names the measured node on each side (`gap` lives on the container, a row's height on the row).
   - Compare at the fixed widths CI uses (390, 1280). Set night the same way on both sides: the artifact reads `[data-theme=dark]` (and `prefers-color-scheme`); the story uses its own night look from `.storybook/looks.ts`.
   - An exception lives in the map file next to its pair, with the reason. William approves each one.
4. **When the artifact changes,** the artifact session copies the new page into `designs/2026-10-20-design-language/`. The check then fails where code is behind, and that list is the work.

## Order

1. Build the check, with the map file holding Rows only (header, row, hover, selected, stage squares, late, count footer, group head), at desk and phone width.
2. Tokens to the artifact values. Fix what the check and the contrast test then report.
3. Rows to zero differences.
4. Add the other parts to the map one by one (buttons, seg, chips, inputs, cards, sheets, nav, Inbox, Map marks), each to zero.

## Who builds

Look work goes to Opus builders (`implementer`, model opus). Sonnet builders keep logic and plumbing. At most 4 builders at one time across all planners.

## Out of scope

Pixel or screenshot baselines. Layout of whole pages (the check covers parts; pages are parts put together).
