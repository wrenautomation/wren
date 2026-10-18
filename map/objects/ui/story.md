---
type: object
cluster: ui
universe: live
status: verified
verified: 2026-10-17 @ a1e4dde8
entity: packages/ui/.storybook/main.ts:1
---

# story

A Storybook story (CSF): one state of one `@wren/ui` part, in `packages/ui/src/<stem>.stories.tsx` beside the part, served by `pnpm --filter @wren/ui storybook` on :61000 (id `<stem>--<export>`), and run as a test (render, `play`, axe).

## Why this shape

A part tuned in its story needs no portal, backend or login, and the same fixtures feed its unit tests, so a story cannot drift from the code the way a copied HTML playground does. Each story is also a test, so a look that moves fails CI with a diff.

## Shape

- Config: `packages/ui/.storybook/main.ts` (glob `src/**/*.stories.tsx`, addons a11y + vitest, Tailwind and the portal's React plugin), `serve.mjs` (one server per Mac on 61000: a running one is reused)
- Preview: `packages/ui/.storybook/preview.tsx`: tailwind.css, the look from the light/dark toolbar global (dark = `PRESETS.night`), `QUERIES` cleared per story, `HintLayer`, viewports phone 390 / tablet 820 / desktop 1280, axe `test: "error"`; `parameters.layout: "fullscreen"` drops the padding
- Tests: `.storybook/vitest.config.ts` + `vitest.setup.ts` (one project per look in `looks.ts`: light at 390, dark at 1280; fixed clock, no motion, the hash cleared per story), `run.mjs` (the checks lock; one Chromium, one project at a time; no screenshot compare)
- Plays (`storybook/test`): `records--bulk`, `records--sorted`, `list-bar--filtering`, `action--empty`, `action--failed`, `action--form-dialog`, `edit-form--empty`, `edit-form--saved`, `draft--typed`
- Fixtures: `packages/ui/src/fixtures/`: `load.ts` (`answer`, `pending`, `fails`: a read's states), `worst.ts` (`WORST`), `place.ts` (`fakePlace`, `usePlace`), `records.ts` (`fakeRecords`, `useRecordsDemo`), one file per domain. Synthetic only
- Each set: `Default`, `Empty`, `Loading`, `Failed`, `WorstCase`
- Checks: `stories:build` (turbo, outputs `storybook-static/**`) in `scripts/gates.sh` lint; `test:stories` in `gates.sh visual` (in `ui` and `all`) and the CI job `test:stories`

## Connected to

- **owns:** `packages/ui/src/fixtures/`
- **owned-by:** [[ui/kit]]
- **joins:** unit tests that import the fixtures (`records-tiers.test.ts`, `records-local.test.ts`, `action.test.ts`, `cards.test.ts`, `accounts.test.ts`)
- **looks-like-but-is-not:** an HTML playground (a copy, for a new direction only, thrown away)

## If you change this

- **Hits:** a fixture change moves every story and test that imports it; a part's prop change breaks its story's typecheck; a look change fails only where axe reads it (contrast, names)
- **Does not hit:** the portal build, prod

## Surfaces

| Surface | Role |
|---|---|
| Storybook (:61000) | reads |
| CI `test:stories` | tests every story |
| unit tests | read the fixtures |

## See

- Source: `packages/ui/.storybook/`, `packages/ui/src/fixtures/`
- Design: `designs/2026-10-17-storybook-visual-tests.md`
- Skill: `.claude/skills/wren-ui/SKILL.md`
