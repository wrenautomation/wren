---
type: object
cluster: ui
universe: live
status: verified
verified: 2026-10-17 @ fc7f19bb
entity: packages/ui/src/index.ts:1
---

# kit

`@wren/ui`, "the kit": every part the portal draws (shell, record templates, tables, cards, buttons, charts) and the tokens they read (`packages/ui/src/tailwind.css`). Its look is written down in `DESIGN.md`.

## Why this shape

One component per job, so a page never grows its own list or button and a client's look is a theme, not a fork. Apps reach shadcn's libraries (Base UI, Lucide, cmdk, sonner) only through the kit.

## Shape

- Exports: `packages/ui/src/index.ts` (one barrel), plus subpaths `./tailwind.css`, `./palette`, `./theme` (`packages/ui/package.json`)
- Tokens: `--ui-*` on `:root` in `packages/ui/src/tailwind.css`; looks are `PRESETS` and `SHOWCASE` (`packages/ui/src/theme.tsx:141`, `:202`); frame widths are `--layout-*` (`packages/ui/src/display.ts`)
- shadcn parts, owned copies: `packages/ui/src/components/ui/`
- The one door: `packages/ui/src/kit-door.test.ts` fails an app import of a vendor library
- Record templates take a `RecordsApi` and a `Place` (`packages/ui/src/records.tsx`), so they render from any server, or from fixtures

## Connected to

- **owns:** the tokens, every part
- **owned-by:** nothing; `apps/portal/web` is its one app
- **joins:** [[ui/story]] (each part's stories), [[platform/portal-shell]]
- **looks-like-but-is-not:** `apps/portal/web/src/records.tsx` (the portal's page dispatch, not the template)

## If you change this

- **Hits:** every portal screen that uses the part; its stories (`gates.sh lint` builds them); `DESIGN.md` when a token or a rule moves
- **Does not hit:** the API, records served, the lander (its own repo and look)

## Surfaces

| Surface | Role |
|---|---|
| portal | draws every page with it |
| Ladle (:61000) | draws each part alone |

## See

- Source: `packages/ui/src/`
- Look: `DESIGN.md`; design: `designs/2026-10-17-ui-workbench-and-fast-ci.md`
