# Brief M3: editing, starter, guard

Design: `designs/2026-10-19-business-map.md` ("Map page" edit mode, "Seeds", "Decisions (planner)"). Bead `wa-mnu.3`. Worktree `~/worktrees/wren-map-edit`, branch `map-edit`, from `main` (M1 and M2 are in). Read `DESIGN.md`, `.claude/skills/wren-ui/SKILL.md`, card `platform/shape`, the Map page from M2 (`apps/portal/web/src/map/`).

## Goal

The team edits the shape on the Map. Every save is a version with a note. History shows diffs and restores. An empty database starts from a kind-only starter. The legacy funnel columns go.

## Do

1. **Palette**: move `PaletteDrawer` (and the drag item) out of `modules/wren/editor.tsx` into a shared part (`packages/ui/src/graph/palette.tsx`, or the portal's shared folder if it needs portal types). The workflow editor uses the moved part, unchanged in look and keys. The Map's palette lists the four kinds (source, step, offer, plan), each with its glyph and one line.
2. **Edit mode** on the Map (team with the `pipeline` grant only; a button in the top bar, `?edit=1` in the address):
   - Drag a kind from the palette: a new node with a free id from its name (`STAGE_KEY`, unique), panel open on it.
   - Connect by handle (`GraphEdit.connect`): a flow edge; hold Alt (and a toggle in the panel for touch) for a loop edge. `fits` refuses what `checkShape` would (into a source, a self edge, a flow cycle, a plan from two offers), with the reason on hover.
   - Node panel fields by kind: name (inline rename on the node too), source `via`, `channel`, `campaign`, `parked`; step `action`, advance rules (the workflow editor's trigger picker, reused), `idleDays`, `research`; offer `offer` (pick from offer versions); plan `terms` (pick from the offer's plans). Edge panel: label, kind, remove.
   - Remove: refused while open journeys sit on the node. The panel says how many and offers "Move them to …" (a node pick, saved as a `moves` entry) or "Keep as ghost".
   - All edits stay in a local draft (one draft store, survives a reload per viewer like other drafts: `packages/ui/src/draft.tsx`). The bar shows the change count and the `checkShape` problems. Save asks for a note and calls `pipeline.shapeVersion` { body, note, moves }. A refusal shows the server's sentences; nothing is lost.
3. **History**: the M2 panel gains "Restore": it saves a new version with the old body and the note "Restore v<n>". Diff of any two stays.
4. **Import and export on the Map**: Export downloads the YAML (`exportShape`). Import takes a YAML file, shows the diff against the newest, and saves through `pipeline.shapeImport`.
5. **Starter**: `packages/pipeline/src/starter.yaml` (kind-only: node names like "Source", "Comment", "Booked call", "Offer", "Plan"; no channels named after real accounts, no amounts, no terms). The empty Map's "Start from Wren's shape" imports it (note "Starter"). A unit test checks it passes `checkShape`.
6. **Growth Partner offer** (main's decision, logged in the doc): add `growth-partner` to the offers registry (`packages/offers/src/catalog/`), name "Growth Partner", status `draft`, one plain line from the planner (in the brief's appendix below); no amounts, no page, no pitch copy. Check that `pnpm offers:export` leaves it out (it reads live offers) and that `wren offers sync` writes its version, so deals can be made on it. If sync skips drafts, make it sync drafts too, and test it.
7. **Moves remap deals**: when a save carries `moves`, open deals whose `node` is a moved key get the new node (same transaction as the carry). Integration test.
8. **Guard migration** (next free number on main; regenerate journal and snapshot): a `DO $$` guard like 0303 raises when any journey has `node` or `shape_version` null; then drop `journeys.funnel`, `journeys.stage`, `journeys.version` (and their FK and the old `uq_journeys_open`), rename `shape_version` to `version`, set `node` and `version` not null, add unique open journey per person (`profile_id` where `status = 'open'`), drop `uq_deals_journey`. Test the guard as `fold-guard.test.ts` tests 0303. Remove the legacy fields from `schema.ts` and every reader (`migrate.ts` reads old columns with plain SQL behind `to_regclass`/column checks, or `wren shape migrate` goes: say which, and why). The deploy step `wren shape migrate --all` stays only if migrate still has work after the guard; else remove it.
9. **Stories**: Map edit mode (palette open, a drag in `play`, connect, remove refused with people, save with note, save refused), history restore, import diff, empty Map start. `./scripts/gates.sh ui` passes.
10. **Map cards**: `platform/shape`, `ui/CONTEXT.md`, `platform/offer` (growth-partner draft). `map/_meta/build.sh` then `--check`.

## Not

- No real shapes in the repo. Wren's and the client's shapes live in the private sops repo (`shapes/*.yaml`); main imports them on prod.
- No automatic 90-day loop crossing (planner decision).
- Nothing against prod. No push.

## Checks and commits

As M2: `./scripts/gates.sh changed`, `./scripts/gates.sh ui`, full `./scripts/gates.sh` once at the end, nothing left running, Biome format, commit only your paths, ending:

```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PpzL4T1jZXndKhYDqy2SGC
```

## Appendix: the Growth Partner line

"We fix your offer, then run your acquisition end to end; you close your own calls."
