---
type: object
cluster: ui
universe: live
status: verified
verified: 2026-10-17 @ fc7f19bb
entity: packages/ui/.ladle/config.mjs:1
---

# story

A Ladle story: one state of one `@wren/ui` part, in `packages/ui/src/<stem>.stories.tsx` beside the part, served by `pnpm --filter @wren/ui stories` on :61000 (id `<stem>--<export>`).

## Why this shape

A part tuned in its story needs no portal, backend or login, and the same fixtures feed its unit tests, so a story cannot drift from the code the way a copied HTML playground does.

## Shape

- Config: `packages/ui/.ladle/config.mjs` (glob `src/**/*.stories.tsx`, port 61000, widths phone 390 / tablet 820 / desktop 1280), `.ladle/vite.config.ts` (Tailwind; React from Ladle's own plugin, Vite 6)
- Provider: `packages/ui/.ladle/components.tsx`: tailwind.css, the look (dark = `PRESETS.night`), `QUERIES` cleared per story, `HintLayer`; `meta = { bare: true }` drops the padding
- Fixtures: `packages/ui/src/fixtures/`: `load.ts` (`answer`, `pending`, `fails`: a read's states), `worst.ts` (`WORST`), `place.ts` (`fakePlace`, `usePlace`), `records.ts` (`fakeRecords`, `useRecordsDemo`), one file per domain. Synthetic only
- Each set: `Default`, `Empty`, `Loading`, `Failed`, `WorstCase`
- Checks: `stories:build` (turbo, outputs `build/**`) in `scripts/gates.sh` lint; `gates.sh ui` for UI-only work

## Connected to

- **owns:** `packages/ui/src/fixtures/`
- **owned-by:** [[ui/kit]]
- **joins:** unit tests that import the fixtures (`records-tiers.test.ts`, `records-local.test.ts`, `action.test.ts`, `cards.test.ts`, `accounts.test.ts`)
- **looks-like-but-is-not:** an HTML playground (a copy, for a new direction only, thrown away)

## If you change this

- **Hits:** a fixture change moves every story and test that imports it; a part's prop change breaks its story's typecheck
- **Does not hit:** the portal build, prod

## Surfaces

| Surface | Role |
|---|---|
| Ladle | reads |
| unit tests | read the fixtures |

## See

- Source: `packages/ui/.ladle/`, `packages/ui/src/fixtures/`
- Skill: `.claude/skills/wren-ui/SKILL.md`
