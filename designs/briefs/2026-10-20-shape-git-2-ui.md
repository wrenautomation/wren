# Brief G2: history like git, Map UI

Design: `designs/2026-10-19-business-map.md`, "History like git (William, 2026-10-20)" and "Map page, M2.1". Bead `wa-dcr.2`. Worktree `~/worktrees/wren-shape-git-ui`, branch `shape-git-ui`, from branch `shape-git`. Read `DESIGN.md`, `.claude/skills/wren-ui/SKILL.md` (if present), card `map/objects/ui/CONTEXT.md`, then `apps/portal/web/src/map/` (MapPage, Draft, History, NodePanel, EditPanel, read, model, diff), `today.tsx`, `waiting.ts`, `pages-map.stories.tsx`, `mocks/data/map.ts`.

The server side is built at the same time by G1 in another worktree. Code against the committed contract, not against G1's code: `packages/pipeline/src/history.ts` (every route's ask and answer, `DraftRow`, `DraftDetail`, `VersionLine`, `BlameLine`, `ShapeRef`) and `diff.ts` (`ShapeChange`, `changesOf`, `changeKey`, `changeLine`, `changeLines`). Import those types; never copy them into the web. Stub the routes in MSW (`mocks/data/map.ts`) with synthetic data. If a type there is wrong for the UI, say so in your report; do not change it.

## The routes (all `pipeline/<route>` through `call`, with the workspace params `atOf(client)`)

| Route | Takes | Answers |
|---|---|---|
| `shapeDraftNew` | `DraftNewAsk` | `DraftNewAnswer` |
| `shapeDraftUpdate` | `DraftUpdateAsk` | `DraftUpdateAnswer` |
| `shapeDraftPropose` | `DraftIdAsk` | `DraftStateAnswer` |
| `shapeDraftApply` | `DraftIdAsk` | `DraftApplyAnswer` |
| `shapeDraftDrop` | `DraftDropAsk` | `DraftStateAnswer` |
| `shapeDiff` | `DiffAsk`: `a`, `b` a number or `draft:<id>` | `DiffAnswer` |
| `shapeBlame` | `BlameAsk` | `BlameAnswer` |
| `shapeUndoPreview` | `UndoAsk` (`change` is `changeKey`) | `UndoPreviewAnswer`, or a 400 with the reasons |
| `shapeUndo` | `UndoAsk` | `UndoAnswer` |
| `shapeTag` | `TagAsk` | `TagAnswer` |

Records: `pipeline.shape`'s detail `versions` are `VersionLine[]` (now with `draft`, `tags`, `mirror`). `pipeline.shape_draft` lists `DraftRow`s (views `open` default, `proposed`, `all`); its `recordsGet` detail is `DraftDetail`. Writes are refused (400) with plain sentences: show them as today's Save does.

## Do

No new palette, type scale or part. A redesign of every section comes next; keep every addition inside the History card and the node and edge cards, reuse `@wren/ui` parts (`Button`, `Alert`, `Tag`, `StateMark`, `Dialog`, `TextField`, `useEditForm`/`useEdit`) and the reads through `useCall`/`call`. One shared helper per job (e.g. one `useDrafts`, one `useBlame`), never a per-card copy.

1. **Model**: `map/model.ts`'s `Version` becomes `VersionLine` from `history.ts` (or an alias of it). `read.ts` passes it through.
2. **History card** (`History.tsx`; split into small files in `map/` if it grows past ~300 lines):
   - Each version line shows its tags (`Tag`), the draft it came from ("from draft <name>"), and the mirror's short sha as a link to `mirror.url` (opens a new tab). No sha: nothing.
   - **Tag**: on a version, "Tag" (act only) opens a small form (name, note) and calls `shapeTag`. Tags never edit or delete.
   - **Undo one line**: in the picked-two diff list, each line (from `changesOf`/`changeLine`) gets "Undo" (act only). It reads `shapeUndoPreview` for `{a, b, change: changeKey(c)}` and shows the preview's lines (`changeLines` of its bodies) or its refusal; "Undo" then calls `shapeUndo` and reads the Map again. Restore of a whole version stays as it is.
   - **Drafts** section (a tab or a heading in the card: Versions | Drafts, with the count of open drafts): rows from `pipeline.shape_draft` view `open`, each with name, state (`StateMark`), base, author, updated. Per draft: Open (into edit mode, see 3), Compare (pick a version or live; the same diff drawing and lines as two versions, through `shapeDiff` with `draft:<id>`), Propose (state `draft` only), Apply, Drop (asks a reason). "Show applied and dropped" reads view `all`.
   - **Apply dialog**: the draft's diff against live first. When the draft's `base` is older than the newest version, it first shows the diff from base to live and the warning "Live changed since this draft started." Apply calls `shapeDraftApply` and reads the Map again. No merge.
3. **Edit mode exits** (`Draft.tsx` bar and `SaveDialog`): three exits.
   - "Save version": as today.
   - "Save as draft": a dialog (name, note) calls `shapeDraftNew` with the device draft's body and moves and `base` = the newest version; on success the device draft clears and edit mode shows the server draft opened (as below).
   - "Update draft" (only when a server draft is open): `shapeDraftUpdate` with the body and moves; the device draft clears.
   - Opening a draft: `?edit=1&draft=<id>` in the address. The canvas draws the draft's body in edit mode; the device-local store (`useEdit`) keys by the draft (`map:draft:<client>:<id>`) so live edits and a draft's edits never mix. A banner over the canvas (the bar's style) says the draft's name, its base ("from version n") and its author, with Close (back to live).
   - Leaving a draft with unsaved device edits asks as edit mode does today.
4. **Node history** (`NodePanel.tsx`, and the node edit card in edit mode): a "History" section reads `shapeBlame { node }` when the card opens: one line per version (version, how, note, who, day), newest first. Each line opens the History card with that version and its parent picked. The edge card (`EdgeEdit` in `EditPanel.tsx`, and any edge details card) the same with `{ edge }`. One shared `BlameList` part in `map/`.
5. **Today line** (`today.tsx`, Wren's and a client's): "N shape proposals wait" when `pipeline.shape_draft` view `proposed` has rows, linking to the Map with History open on Drafts (`/?history=drafts`; make the Map read that param). Prefer the existing waiting mechanism (`waiting.ts`: a page with a `count` over `pipeline.shape_draft` `{ state: "proposed" }`) if a page fits without a new sidebar tab; else one small read through the same data layer. Say which in your report, and why.
6. **Stories** (`pages-map.stories.tsx`, MSW in `mocks/data/map.ts`, synthetic data): History with tags and shas; the Drafts list with a proposed draft; Compare a draft with live; the apply dialog with "live changed"; undo preview and an undo refused; edit mode on an opened draft with its banner; "Save as draft" dialog; node history in the panel; Today with the proposals line. Each with a `play` that clicks through the main step. `./scripts/gates.sh ui` passes (it runs the story tests: render, play, axe, light and dark).
7. **Unit tests** for the pure parts you add (e.g. the draft address and store key, the state transitions the UI allows per draft state, the blame line text). Use `vitest run <file>` from `apps/portal/web`.
8. **Map card**: `map/objects/ui/CONTEXT.md` (the History card's drafts, tags, undo, sha; node history; the Today line). `map/_meta/build.sh` then `--check`.

## Not

- No server files (`packages/**`, `apps/worker`, `apps/cli`). G1 and G3 own them. If the contract misses something you need, say so; do not add server code.
- No new colors, fonts or sizes. No pixel baselines.
- Nothing against prod. No push.

## Checks and commits

While you build: `./scripts/gates.sh ui` and single test files. Never tsc, turbo or vitest for the whole repo; never wrap `pnpm test:stories` in lockf (it deadlocks; `gates.sh ui` takes the lock itself). Stop Storybook and every server you start. Biome format each file (`pnpm -s biome format --write <file>`); strings with inner double quotes use single quotes. `git add` new files, then `git commit -- <paths>`. Messages end with:

```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PpzL4T1jZXndKhYDqy2SGC
```

Report: the commit shas, what each does, what you skipped and why, the Today choice, and any contract gap. Leave no process running.
