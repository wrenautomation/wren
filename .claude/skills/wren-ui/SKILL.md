---
name: wren-ui
description: Change how a portal screen or a @wren/ui part looks or lays out, and check it in a Ladle story before the portal. Use for UI tuning, a layout bug, a new state of a part, or a new part. For where a page lives in the portal (William's navigation), use the `portal` skill.
---

# Tuning the portal's UI

The look's rules are `DESIGN.md` (repo root). The route from a screen to its part and story is the map's UI hub, `map/objects/ui/CONTEXT.md`. Where a page sits for William: the `portal` skill.

## Loop

1. Read the `DESIGN.md` section for the part (Colors, Typography, Layout, Components → Buttons, Lists and records, Tables, Cards, Navigation and shell, Phone, Charts, Motion).
2. Find the part and its story ids in `map/objects/ui/CONTEXT.md`. A `template` page is drawn by its template; tune the template.
3. Start Ladle in the background: `pnpm --filter @wren/ui stories`. It serves http://localhost:61000.
4. Open one story: `http://localhost:61000/?story=<stem>--<state>`, for example `records--worst-case`. Add `&mode=preview` for no Ladle chrome, `&theme=dark` for the night look.
5. Edit the part in `packages/ui/src/`. Ladle reloads it.
6. Screenshot what you changed, phone and desktop, both looks:
   `pnpm --filter @wren/ui stories:shot --width 390 --dark records--worst-case shell--default`
   It writes PNGs to `<tmp>/wren-ui-shots/` and exits 1 on a page or console error. Read the PNGs.
7. Test the file you changed: `cd packages/ui && pnpm exec vitest run src/<file>.test.tsx`.
8. Check before commit: `./scripts/gates.sh ui` (Biome on changed files, typecheck of ui + portal, related tests).
9. Stop Ladle: `pkill -f "ladle serve"`, then `lsof -i :61000` shows nothing.

Run the full gate (`./scripts/gates.sh all`) once, at hand-off. Not in the loop.

## Stories

- A story file sits beside its part: `packages/ui/src/<stem>.stories.tsx`. Id = `<stem>--<export>` in kebab case.
- Each set exports `Default`, `Empty`, `Loading`, `Failed`, `WorstCase`. Add a named state when a part has one (`PanelOpen`, `Bulk`).
- Data comes from `packages/ui/src/fixtures/`, never inline in a story. A read's states: `answer`, `pending`, `fails` (`load.ts`). Long text and huge numbers: `WORST` (`worst.ts`). An address: `fakePlace`, or `usePlace` for a live one (`place.ts`). Records: `fakeRecords`, `useRecordsDemo` (`records.ts`).
- Fixtures are synthetic only. The repo is public: no real names, leads, amounts or clients.
- Unit tests import the same fixtures. A new fixture goes in the domain file, or a new one, and `fixtures/index.ts`.
- `export const meta = { bare: true }` drops the 24px padding for a full-frame part (shell, panel).
- Widths: phone 390, tablet 820, desktop 1280 (Ladle's width button, or `--width`).
- `./scripts/gates.sh lint` builds every story (`stories:build`). A part's prop change that breaks a story fails there.

## When to leave the story

- **`/impeccable live`**: the look depends on the real page around the part: a hand page, the marketing pieces (no story: they load `api.ts`), the shell with real data. Start the portal on your machine (`pnpm --filter @wren/portal preview`) and pick the element there. The preview is a build, not hot reload: run it again to see an accepted change.
- **An HTML playground**: a new direction before any build, to compare looks fast. Throw it away after. Never keep it beside a part: it copies the code and drifts.
- **Never** shoot or scan prod (`app.wrenautomation.com`): it spends the portal Worker's free request cap.

## Done

- Screens shot at 390 and 1280, light and dark, read by you.
- `gates.sh ui` passes. `DESIGN.md` changes in the same commit when a token or a rule moves.
- Ladle and any browser stopped.
