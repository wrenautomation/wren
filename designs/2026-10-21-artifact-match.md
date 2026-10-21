# Artifact match (2026-10-21)

William: the UI must match the artifacts exactly. "Close" is a fail. Two artifacts are the source of truth, and they change as he learns:

- **Design Language** (`designs/2026-10-20-design-language/`): tokens, parts, every app surface.
- **Studio and Marketing** (`designs/2026-10-21-studio-marketing/`, six boards: Main, Compose, Inbound, Outbound, Offer, Phone): the Studio and Marketing pages.

The artifacts override all old UI. Old tokens, borders, spacing, layouts and parts go where they differ. Nobody asks to keep an old value, and nobody keeps one because it was an earlier decision.

## Why we drifted

1. Builders kept old portal values (`--ui-hair` 22% against 11%, `--ui-fill` 6% against 5%, night ink-3) as if they were decisions.
2. Builders wrote CSS by eye from a shot, so each value drifted a little.
3. No check compared code to artifact. Story tests check render, play and axe only.

## Target state

1. **Tokens are the artifact's.** `packages/ui/src/tailwind.css` takes each artifact token value as it is, day and night. The `--ui-*` names can stay; their values are the artifact's. An old token the artifact does not have goes, unless a part the artifact draws needs it. If an artifact value fails the contrast test, report it to William and the artifact session; the artifact gets the fix.
2. **Parts port the artifact CSS.** Each part in `packages/ui` takes its values from the artifact rule: padding, gap, radius, border, font size and weight, colours, hover and selected. No value made by hand. A part the artifact does not draw (like the row/card toggle) goes.
3. **Pages follow the boards.** A page that has a board or section (Studio, Marketing, Inbox, Map, Today, People) takes its layout from it: what shows, in what order, what is left out.
4. **A match check in the gate** keeps 1 to 3 true.
   - A map file (`packages/ui/match/parts.ts`) lists pairs: an artifact file + selector, and a story id + selector for the same part, day and night.
   - A Playwright script opens the artifact page and the story (local Storybook on MSW), reads `getComputedStyle` for a fixed property list, and compares. Properties: padding, gap, border width, style and colour, border radius, background colour, colour, font family, size, weight, line height, letter spacing, box shadow, row height.
   - Colours compare after resolve to rgba, with a small tolerance for rounding. Lengths compare exactly.
   - One artifact node per part. The artifact draws some parts in several sections; the map pins one, and names the measured node on each side (`gap` on the container, height on the row).
   - Compare at 390 and 1280. Set night the same way on both sides: the artifact reads `[data-theme=dark]`; the story uses its night look from `.storybook/looks.ts`.
   - Any difference fails. The output names the part, the property and both values.
   - It reads computed styles, never pixels. The no-pixel-compare rule holds.
   - It runs in `gates.sh ui` and in CI's story job.
   - No exceptions for old values. A difference is fixed in code, or the artifact changes.
5. **When an artifact changes,** the artifact session copies it into its `designs/` folder. The check then fails where code is behind, and that list is the work.

## Order

1. Build the check. Map file holds Rows first (header, row, hover, selected, stage squares, late, count footer, group head), at 390 and 1280.
2. Tokens to the artifact values. Fix what the check and the contrast test then report.
3. Rows to zero differences.
4. Every other part to zero, one by one: buttons, seg, chips, inputs, cards, sheets, nav, Inbox, Map marks.
5. Studio and Marketing pages to the boards.

## Who builds

Look work goes to Opus builders (`implementer`, model opus). Sonnet builders keep logic and plumbing. At most 4 builders at one time across all planners.

## Out of scope

Pixel or screenshot baselines.
