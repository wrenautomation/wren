# Code quality sweep: handoff (2026-10-24)

A fresh session (cloud, Fable) reads this first. Goal: less duplication, clean layers, easy to find, easy to extend. Build each fix; do not only list it.

## William's prompts (2026-10-24)

> just checking code quality. surely all these components are globalized so that changing such an icon would require at most 1 or 2 changes, and it would propagate across all the pages correct? just making sure code is maintainable.

> lets suggest plans for making the code better. this was a gap, theres probably more gaps that are unnecessarily creating code bloat and complexity.

> a handoff doc with my prompts and info about reducing duplication, DRY, SOLID principles, shared interfaces from high level to low level (dependency SOLID principle) and supporting extensibility, organizing packages well so things are easy to find and theres not insane levels of nesting on a package level but on a code level abstractions are clean

## What started it

Row actions and 20 files drew Lucide icons direct, past the registry. A change to one icon needed many edits. Fixed in ea1bd2c4:

- Every icon has a name in `packages/ui/src/icons.tsx`. `lib/lucide.ts` is gone.
- `biome.json` `noRestrictedImports` stops a `lucide-react` import outside `icons.tsx`.

The pattern to repeat: **one owner per concern, and a lint rule that keeps it one.** A fix without the rule drifts back.

## Known gaps (start here)

| # | Gap | Where | Fix |
|---|---|---|---|
| 1 | Three vendored parts still import Lucide; biome skips their folder | `packages/ui/src/components/ui/{dialog,sheet,command}.tsx` | Draw through `Icon`. Let biome see that folder for the import rule. |
| 2 | Row action icons come from a regex on the label | `packages/ui/src/row-acts.tsx` `VERBS` | Each action names its icon. A renamed label then cannot change an icon. |
| 3 | Other vendors may have the same bypass | all `packages/*`, `apps/*` | For each vendor with a shared wrapper, add a `noRestrictedImports` path. List them first. |
| 4 | Flaky stories fail main at random (Player Expanded, Client Failed, Map Draft View); `push.sh` read a running CI as "cancelled" | `apps/portal/web/src/pages-*.stories.tsx`, `scripts/push.sh` | Find each flake's race; fix the wait, not a retry. Fix the status read. |
| 5 | Very big files | `core/src/console.ts` 4001, `ui/src/records.tsx` 3411, `worker/src/services.ts` 3002, `outreach/src/restate/index.ts` 2473, `portal/.../marketing/index.ts` 2181, `marketing/finish.tsx` 2102, `delivery/src/index.ts` 1946 | Split by job, one concern per file. No behavior change in the same commit. |
| 6 | About 20 lint warnings hide new ones; `biome.json` uses the deprecated `recommended` | `scripts/*.mjs` (`noUndeclaredEnvVars`), `biome.json` | Clear them once. Then make warnings fail CI. |

## Principles to apply

**DRY.** One fact, one place. Two copies of the same rule is a bug waiting. But do not merge two things that only look the same today: merge when they change for the same reason.

**SOLID, in this repo's terms:**

- **Single responsibility.** A file or module has one reason to change. A 3,000-line file has many.
- **Open/closed.** Add a new channel, kind or action by adding a file or a table row. Do not edit a central `switch`. Registries (`ICONS`, the channel list) are the model.
- **Liskov.** Every adapter behind an interface keeps the interface's promise. A fallback answers the real API's shape (memory: grants and shared interface).
- **Interface segregation.** Small interfaces that a caller needs. Not one wide `Services` object passed everywhere.
- **Dependency inversion (the main one).** High-level code (campaigns, pipeline, products) depends on interfaces it owns. Low-level code (Postgres, Restate, vendor SDKs, autobrowse) implements them. The composition root (`apps/worker`, `apps/cli`) wires them. Arrows point down to `core`; a foundation never imports a product (the `@wren/reactivation` rule in `biome.json` already does this for one package).

**Extensibility.** A new channel or app plugs in through the same seam as the others: a type, a registry entry, an adapter. If adding one needs edits in five files, the seam is missing.

## Package layout

Target: **flat at the package level, clean at the code level.**

- Today: 40 packages under `packages/`, 8 apps. `packages/` is one level; keep it so. No `packages/channels/x/...` nests.
- Inside a package, at most 3 levels of folders under `src/`. Today `ui/src` goes 8 deep and `studio/src` 7. Flatten where a folder holds one file.
- A package name says what it owns. Its `index.ts` is its public face; others import only that (or named `exports`), never deep paths.
- Group by domain, not by kind: `channel-sms/src/send.ts`, not `src/services/sms/sendService.ts`.
- Check the layers with a tool, not by eye. Option: `dependency-cruiser` (MIT, widely used) for "foundation never imports product" and "no cycles" across all packages. Biome rules cover single imports only.

## How to work

1. Read `CLAUDE.md` and `map/routing.md`. Use the map: one hub, one card.
2. Pick one gap. Build the fix and its guard rule in the same commit.
3. While you build, check with `./scripts/gates.sh changed`. Run the full gate once at hand-off.
4. Commit with `git commit -m ... -- <paths>`; push with `sh scripts/push.sh <sha>`.
5. The repo is public: no lead data, amounts, client names or secrets.
6. A large refactor (split a 3,000-line file, move a package) gets a short plan in this file first.

## Out of scope

Security review (separate audits). New features. UI look (the Design Language artifact owns it).
