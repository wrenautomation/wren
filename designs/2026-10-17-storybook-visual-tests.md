# Storybook and visual tests

2026-10-17, bead wa-u4r. William: "make a top tier research backed version that industry standard uses."

Replaces Ladle (designs/2026-10-17-ui-workbench-and-fast-ci.md, part A2) with Storybook, and adds the layer Ladle had none of: every story is a test, with an accessibility check and a screenshot compare.

## Why

- Ladle 5.1.1 is the last release (2025-11). It pins Vite 6; the portal is on Vite 8. Its config already works around it.
- Storybook 10.6.2 (2026-10-12) supports Vite 8, React 19, Vitest 5. GitHub Primer, Microsoft Fluent, Shopify Polaris, Airbnb build on it.
- The industry loop: workbench per component → each story a test (render, interaction, a11y) → screenshot diff in CI against approved images → only changed parts rerun. Turbo plus the remote cache already gives the last part.
- Chromatic (Storybook's hosted screenshots) is paid and hosted: out. Lost Pixel: no release since 2024-11: out. Vitest browser mode's own `toMatchScreenshot` does it free, in the runner we already use.

## Build

1. **Storybook in `@wren/ui`.** `storybook@10.6.2`, `@storybook/react-vite`, `@storybook/addon-a11y`, `@storybook/addon-vitest`, exact versions. Config in `packages/ui/.storybook/` (`main.ts`, `preview.tsx`). `viteFinal` adds `@tailwindcss/vite`; the React plugin matches the portal's. `preview.tsx` decorators replace `.ladle/components.tsx` (theme, `tailwind.css`, the fixed-answer `QueryClient`). A light/dark toolbar global. Viewports 390, 820, 1280. Port 61000 stays.
2. **Move the 13 story sets.** They are already Component Story Format. Ladle-only parts change: `meta = { bare: true }` → `parameters: { layout: "fullscreen" }`; Ladle args/controls → Storybook `args`/`argTypes`. Story ids stay `<stem>--<state>` where Storybook allows; update the map's `ui` cards for any id that moves. Fixtures stay in `packages/ui/src/fixtures/`, unchanged.
3. **Interaction tests.** A `play` function (`storybook/test`: `userEvent`, `expect`) on each story whose part has a real interaction: records (select, bulk), list-bar (tab, filter), action (open dialog, submit), edit-form (type, error, save), table (sort), draft. No `play` on a static state.
4. **Stories as tests.** `@storybook/addon-vitest` with a Vitest `browser` project (`@vitest/browser-playwright`, chromium, headless). Every story renders; `play` runs; a11y runs with `parameters.a11y.test = "error"`. A known a11y gap may be `"todo"` with a one-line reason, never silent.
5. **Screenshot compare.** In the same story test run: each story at 390 and 1280, light and dark, `toMatchScreenshot`. Baselines committed under `packages/ui/__screenshots__/`.
   - Pixels differ between macOS and Linux (fonts, antialias). Baselines are made only in the Playwright Docker image (`mcr.microsoft.com/playwright:v1.63.0-noble`), the same image CI runs in. A script `pnpm --filter @wren/ui test:visual:update` runs the update in that image on the Mac.
   - Freeze what moves: animations off (`prefers-reduced-motion` + a CSS kill in the test preview), fixed clock in fixtures, fonts loaded before the shot (`document.fonts.ready`).
   - A small threshold for antialias noise; a real change fails.
   - CI failure uploads the diff PNGs as an artifact.
6. **Turbo.** Task `test:stories` (stories as tests + screenshots), inputs `packages/ui/**` and the baselines. `stories:build` stays (now `storybook build`, outputs `storybook-static/**`). Both cached; a change outside UI is a hit.
7. **CI.** `test:stories` runs in a job on the Playwright container in `ci.yml` (blocks deploy, like lint), using the remote turbo cache. Measure its time; it must stay under 3 min cold.
8. **Gates.** `gates.sh ui` adds `test:stories` for `@wren/ui` (under the lock). `gates.sh lint` keeps `stories:build`.
9. **Remove Ladle.** Drop `@ladle/react`, `.ladle/`, `stories:shot`'s Ladle URLs. `stories:shot` moves to Storybook's iframe URL (`/iframe.html?id=<id>&viewMode=story&globals=theme:dark`) or is replaced by the screenshot test output; keep one way, not two.
10. **Docs.** Update `.claude/skills/wren-ui/SKILL.md` (still under 80 lines), the map's `ui` hub and cards, `DESIGN.md` references, and part A2 of the earlier design doc (one line: replaced by this doc).

## Done

- `pnpm --filter @wren/ui storybook` serves every story on 61000, light and dark, three widths.
- `test:stories` passes locally (Docker) and in CI; a one-pixel-meaningful change to a part fails it with a diff artifact.
- No Ladle left in the repo. Full gate green.

## Decision log

- Storybook over Ladle: Ladle is stale and pinned to Vite 6; Storybook is the standard and runs stories as Vitest tests.
- Vitest `toMatchScreenshot` over Chromatic, Lost Pixel, Happo, Loki: free, self-run, same runner, maintained.
- Baselines from Docker only: macOS and Linux render text differently; one source of pixels.

## Mac memory (added 2026-10-17)

- `test:stories` and `test:visual:update` queue on `/tmp/wren_automation-checks.lock`, like every gate. CI skips the lock.
- One Storybook server per Mac. A second `storybook` call reuses the server on 61000.
- Browser tests use one Chromium instance and a bounded worker count. Chromium, Docker and Vitest stop on exit, on failure and on Ctrl-C. Peak memory stays under 3 GB.
- `.githooks/pre-push` typecheck runs under the lock (bead wa-aua).

## Screenshots off (2026-10-18)

William: "deprioritize the screenshots idec about pixel perfect validation at least for now, and it just seems like it creates more issues than it solves."

- `toMatchScreenshot`, the baselines (`packages/ui/__screenshots__/`, 364 PNGs), `test:visual:update` and the Docker run are gone. Story tests keep render, `play` and axe.
- Two looks, not four: light at 390, dark at 1280. Axe reads each theme's contrast and each width's layout once. Native on the Mac: ~20 s, peak 1.6 GB.
- To bring screenshots back: `toMatchScreenshot` in `vitest.setup.ts`'s `afterEach`, baselines from one OS image only (the Docker run in git history, 3adccbca).
