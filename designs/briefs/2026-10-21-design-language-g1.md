# Briefs G1: shape edit ops

Design: `designs/2026-10-20-design-language.md`, "Proposal G: editing the shape" and its Decisions. Prior: `designs/briefs/2026-10-20-design-language-c1.md` (the metro model, `runOf`, `metroView`). Bead `wa-7oo.11`.

Worktree `~/worktrees/wren-shape-g1`, branch `shape-g1`, from `origin/main` (4548a5ba). One builder at a time. Part 1 is pure. Part 2 wires it. Each part is one or more commits. All of it is additive and pushable. No migration.

Read first: `packages/pipeline/src/{metro,metro-diff,metro-edit,metro-file,convert,stored,drafts,store,history,console,console-routes}.ts`, `packages/pipeline/test/fixtures.ts` (`metroShape`, `wideShape`), `apps/cli/src/shape.ts`, `apps/portal/web/public/agent/SKILL.md`, `map/objects/platform/shape.md`.

## The target in one paragraph

Every editor writes typed ops into a draft: the CLI, an agent through `/api/agent`, later the Map chat (G2). An op names ids. Ops act on a metro body. A draft forked from a graph version is drawn with `metroView` first, in memory. A draft is not checked in full until apply; an op batch is refused only when the body it makes is not a metro body in structure (`parseMetroBody`), and `checkMetro` and `lowerable` come back as warnings. Apply checks the base: when live moved, the draft merges by id, three way (base, live, draft). Different items, and different fields of one item, merge. One field changed on both sides to different values is a conflict that shows both values, and it blocks apply. Apply needs a metro live: when live is a graph, apply refuses with "Live is a graph. Run `wren shape convert` first." (William 10-21: prod converts fully before G1 lands).

No CRDT. No UI (area D owns the web). Never run `wren shape convert --write` on prod. Never push branch `shape-c1-held`.

---

## Part 1: ops and merge (pure)

New files only, plus one export. No file imports `@wren/db`.

### 1. `src/metro-ops.ts`

The op kinds act on lines, stations, tracks and groups, the shape name, and attach lists. Frames and flows have no ops yet (a body keeps them as they are).

```ts
export const OP_ONS = ["line", "station", "track", "group"] as const;
export type OpOn = (typeof OP_ONS)[number];

export type MetroOp =
  | { op: "add"; on: "line"; item: MetroLine }
  | { op: "add"; on: "station"; item: MetroStation }
  | { op: "add"; on: "track"; item: MetroTrack }
  | { op: "add"; on: "group"; item: MetroGroup }
  | { op: "rename"; on: "line" | "station" | "group"; id: string; label: string }
  | { op: "rename"; on: "shape"; name: string }
  | { op: "move"; on: "station"; id: string; line?: string; column?: Column; group?: string | null }
  | { op: "move"; on: "track"; id: string; from?: string; to?: string }
  | { op: "move"; on: "group"; id: string; line: string }
  | { op: "move"; on: "line"; id: string; before: string | null }
  | { op: "remove"; on: OpOn; id: string }
  | { op: "set"; on: OpOn; id: string; field: string; value: unknown }
  | { op: "attach"; on: "line" | "station" | "group"; id: string; ref: Attach }
  | { op: "detach"; on: "line" | "station" | "group"; id: string; ref: string };
```

- `MetroOpSchema`: a zod schema (zod 4, as `console.ts` uses) for the op envelope: `op`, `on`, ids, `label`, `name`, `before`, `field`, the move fields. `item`, `value` and `ref` are `unknown`/loose in the schema; the body check below types them. Export `opsJsonSchema()` (`z.toJSONSchema`): G2 hands it to the model as tool input. Descriptions on every field, short and plain.
- `parseOps(v: unknown): MetroOp[]`: one op or an array of ops. Refused with every reason, each prefixed `Op <n>: ` (1 based).
- `applyOp(body, op): MetroBody` and `applyOps(body, ops): MetroBody`. Pure, never mutate inputs. Refused (`Refused`) with every reason found; in `applyOps` each reason starts `Op <n>: ` and the batch is all or nothing.
- What each op does:
  - **add**: the id is free in its kind (ids are unique within a kind, C1 Decisions). Station id `hub` and `dropped` are refused. The item goes at the end of its list.
  - **rename**: the item exists; `label` is 1 to 80 characters after trim. `on: "shape"` sets `name`.
  - **move** (where a thing sits):
    - station: `line` (exists), `column` (one of `COLUMNS`), `group` (a group id: the station leaves its old group and joins this one at the end; `null`: it leaves its group). At least one field. The hub does not move.
    - track: `from`, `to` (each a station that exists). At least one.
    - group: `line` (exists).
    - line: its place in `lines`: before line `before`, or last when `null`. The order of `lines` is the order the renderer stacks them.
  - **remove**:
    - station: as `withoutStation` in `metro-edit.ts` (its tracks, its place in a group or a frame, a group or frame left empty, a frame that exits there). Export `withoutStation` from `metro-edit.ts`; do not copy it. The hub is refused.
    - line: refused while it holds anything, with one reason each: a station on it, a track drawn in it, a group on it, a track that names it in `entries`. Same words as `undoMetroChange`'s "still holds".
    - track, group: the item goes.
  - **set**: one field of one item. `value: null` removes the field. Refused for `id`, and for a field that has its own op: `label` (rename), `attach` (attach, detach), a station's `line` and `column` and a group's `line` and `stations` (move), a track's `from` and `to` (move). Any other field name is allowed here; the body check types it.
  - **attach**: adds `ref` to the item's `attach`. Refused when the item has an attach with the same `kind` and `ref`.
  - **detach**: removes the attach whose `ref` equals `ref`. Refused when there is none. An empty `attach` list goes from the item.
- After the ops run, the result goes through `parseMetroBody` (structure only). A refusal there refuses the batch, with its reasons.
- An unknown id is refused: `There is no station "<id>".` (and line, track, group).

`editMetro(body: StoredBody, ops: unknown, ctx?: ShapeCheckContext): { body: MetroBody; lines: string[]; warnings: string[] }` (in `metro-ops.ts`, pure): `metroView(body)`, `parseOps`, `applyOps`; `lines` = `metroChangeLine` for each change from `metroView(body)` to the result; `warnings` = `checkMetro(result, ctx)` (when `ctx` is given) and `lowerable(result)`, each once.

### 2. `src/metro-merge.ts`

`mergeMetro(base: MetroBody, live: MetroBody, draft: MetroBody): { body: MetroBody; conflicts: Conflict[] }`. Pure.

```ts
export interface Conflict {
  /** The change key of the item, as metro-diff gives it: `station:<id>:changed`, `name`. */
  key: string;
  /** The field both sides changed; none when the whole item clashes (removed on one side, changed on the other). */
  field?: string;
  base: unknown; // undefined when the field or item was not in base
  live: unknown; // undefined: removed or unset on live
  draft: unknown;
}
export const conflictLine = (c: Conflict, names): string // one plain line with both values
```

- Per kind in `METRO_ONS` (frames and flows too: the merge must not drop them), per id, with `canonicalJson` for "same":
  - Live equals base: take the draft's item (or its absence). Draft equals base: take live's. Live equals draft: take it.
  - Else, both present: merge field by field over the union of keys. A field equal on both sides, or changed on one side only, merges. A field changed on both sides to different values is a conflict with base, live and draft values.
  - Set fields merge by member: a group's and a frame's `stations`, a track's `entries`. A member added on one side stays; a member removed on one side goes. Order: live's order, then the draft's new members in its order.
  - `attach` merges by member keyed `kind` + `ref`; the same key changed on both sides is a conflict on field `attach`.
  - Removed on one side, changed on the other: a conflict with no `field`.
  - Added on both sides with the same id: field by field with base `undefined`.
- `name`: the same rule as a field; key `name`.
- List order: live's items in live's order, then the draft's added items in the draft's order.
- `model` is `"metro"`. Conflicts in a fixed order: by `METRO_ONS`, then id, then field.
- The merged body is not checked here. Apply checks it (Part 2).

`conflictLine` examples: `Station Book a call: idleDays is 5 on live and 7 in the draft (was 3).` `Track book_to_held: removed on live, changed in the draft.` Short values print as JSON; a value over 60 characters prints `(changed)`.

### 3. `package.json` exports `./metro-ops`, `./metro-merge`.

### 4. Tests (synthetic data only)

`src/metro-ops.test.ts`, `src/metro-merge.test.ts`, on `metroShape()` and `metroOf(wideShape())`:
- Every op kind on every `on` it takes, and each refusal with its own case. Inputs unchanged. A batch with one bad op changes nothing and names that op's number. A batch that adds a join station and then its two in-tracks passes (the body is checked at the end, not op by op).
- `set` with `null` removes a field. `set` on each refused field is refused.
- `editMetro` on a graph body (`wideShape()`) gives a metro body; its `lines` match `metroChangeLine`; warnings carry `checkMetro` and `lowerable` reasons.
- `parseOps` refuses a bad envelope with the op number. `opsJsonSchema()` is a JSON object.
- Merge: disjoint stations and tracks merge; two fields of one station, one per side, merge; one field both sides different is a conflict with all three values; same change on both sides is no conflict; removed vs changed both ways; added on both, equal and different; group `stations` set merge; track `entries` set merge; attach by member; name; frames and flows kept; list order. `mergeMetro(b, b, d)` equals `d`, `mergeMetro(b, l, b)` equals `l` (canonical JSON).

---

## Part 2: drafts, apply, CLI, agent

### 1. Drafts (`src/drafts.ts`)

- `newDraft`: `body` optional. Left out: the body of `base` as stored (a graph stays a graph until the first edit). The CLI and console pass it through.
- `editDraft(db, { id, ops, by, triggers })`: in one `atomic`: lock and read the draft, refuse unless open, `editMetro(d.body, ops, await shapeContext(tx, triggers))`, write the metro body, `updated_at = now()`. Answers `{ draft, lines, warnings }`. `by` is taken for the answer and later use; the author stays `created_by` (no column).
- `planApply(db, id)` (read, no lock needed beyond the snapshot it runs in): reads the draft, its base version and the newest version. Answers:

```ts
interface ApplyPlan {
  draft: ShapeDraft; base: number; live: number;
  /** True when live moved since the draft's base. */
  moved: boolean;
  conflicts: Conflict[]; conflictLines: string[];
  /** The body apply would save: the draft as a metro body, merged with live when live moved. */
  body: StoredBody;
  /** What the body changes in live, a line each (`storedChangeLines`). */
  lines: string[];
  /** Set when live is a graph: "Live is a graph. Run `wren shape convert` first." */
  refused?: string;
}
```

  Rules:
  - merged = `mergeMetro(metroView(base), metroView(live), metroView(draft))` when moved, `metroView(draft)` when not. `body` = merged.
  - Live is a graph: `refused` is set. The plan still answers, so `draft show` and `shapeDraftPlan` can print it.
- `applyDraft`: take `lock(tx, "shape")` first (transaction scoped, so `saveShape` takes it again safely), then the draft lock, then `planApply` in the same transaction. Refused with `refused` alone when it is set, else with `conflictLines` when there are conflicts. Else `saveShape` with `plan.body`, the draft's moves and note, as today.

### 2. Console (`src/console.ts`, `src/console-routes.ts`, `src/history.ts`)

- `shapeDraftEdit` (`act`, in `PIPELINE_CONSOLE_WRITES`): input `{ id, ops }`; `ops` is one op or an array (`MetroOpSchema`, described for `describe`). Answer `{ id, lines, warnings }`. Wrap in `ctx.run("shape draft edit", …)` as `shapeDraftUpdate` does.
- `shapeDraftPlan` (`read`): input `{ id }`. Answer `{ id, base, live, moved, conflicts: conflictLines, lines, refused? }`.
- `shapeDraftNew`: `body` optional.
- `shapeDraftApply` stays `act` (Decision below). Its refusal carries the graph-live line or the conflict lines.
- Types for the asks and answers in `history.ts`, beside the other draft types.
- `/api/agent` needs no new tool: `wren call PipelineConsole/shapeDraftEdit` reaches it through `call`. Check `apps/portal/src/agent.ts` and `apps/portal/src/edge.ts` (or wherever the Worker lists the PipelineConsole routes it opens) and add the two routes there if a list exists.

### 3. CLI (`apps/cli/src/shape.ts`)

- `wren shape edit <draft> [op]`: `op` is one op as JSON text. `--ops <file>` reads one op or an array from a JSON file, `--ops -` from stdin. Exactly one of `op` and `--ops`. Prints each line of `lines`, then `warning: <w>` for each warning, then `draft <id>: <n> changes from v<live>`.
- `wren shape draft new [file] --name <name>`: the file is optional; without it the draft forks the newest version (or `--base <n>`).
- `wren shape draft show <id>`: prints the author (`by <created_by>`), then the apply plan: `live moved since v<base> (now v<live>)` when it moved, each conflict line (`conflict: …`), `refused: …` when live is a graph, then the lines apply would change. Replace today's direct diff there.
- `wren shape draft apply <id>`: unchanged call; the refusal prints its lines.
- Update the file's header comment: graph edits (`add-node`, `connect`, `remove`) stay for graph versions; ops edit drafts on both.

### 4. Agent skill (`apps/portal/web/public/agent/SKILL.md`)

In the Shape section, replace the draft lines with the op path. Steps for Claude:
1. Make a draft: `wren call PipelineConsole/shapeDraftNew --input '{"name":"…","note":"…"}' --confirm shapeDraftNew` (no body: it forks live).
2. Write ops: `wren call PipelineConsole/shapeDraftEdit --input @ops.json --confirm shapeDraftEdit`. List the op kinds with one example each, in JSON. Ids name things; read them first with `wren get pipeline.shape shape`.
3. Read warnings: each is a reason apply will refuse. Fix them with more ops.
4. Show the diff: `wren call PipelineConsole/shapeDraftPlan --input '{"id":"…"}'`. Show the user `lines`, and any `conflicts` or `refused`.
5. Propose: `shapeDraftPropose`. Never apply or drop unless the user asked.

From a drawing: read the board on draw.wrenautomation.com with the excalidraw skill (`draw` CLI: export the scene or take a screenshot), map each box to a station and each arrow to a track (reuse ids that exist; ask when a shape is unclear), write the ops into a draft, then step 4. Never edit live.

Mirror the same in the repo skill, if `.claude/skills/wren/SKILL.md` or the portal skill holds a shape section (check; edit only what exists).

### 5. Tests

- Integration (`packages/pipeline/test/integration/drafts.test.ts`, run only the files you touch): `editDraft` on a draft forked from a graph version stores a metro body; a refused batch leaves the draft as it was; a closed draft refuses edits. Apply on a metro live with no move saves the draft (a rename and an `idleDays` land on the run); apply after live moved merges two disjoint edits; a conflict refuses and saves nothing; a metro-only change (an attach) saves; apply on a graph live refuses with the convert line and saves nothing (its own database, since a graph cannot follow a metro version). `planApply` answers the same as apply would do.
- Console unit or integration for `shapeDraftEdit` and `shapeDraftPlan` as `console.test.ts` does for the other draft routes.
- CLI unit test for `edit` argument parsing (op text, `--ops` file, both refused), as the CLI tests do today.

### 6. Map

`map/objects/platform/shape.md`: ops, the three-way merge, the graph-live refusal, the two routes and the CLI command, with citations. Run `map/_meta/build.sh`, then `--check`.

---

## Decisions (planner, 2026-10-21)

- **Move** means where a thing sits: a station's line, column and group; a track's ends; a group's line; a line's place in the stack. Why: every other field is `set`; each thing has one way to change it.
- **Ops on four kinds.** Lines, stations, tracks, groups, the name, attach. Frames and flows wait for a need; the merge still keeps them.
- **Unchecked drafts, checked batches.** A batch is refused only for a broken structure; `checkMetro` and `lowerable` are warnings. Why: drafts are half done by design (`newDraft` does not check), and a join station needs its tracks before it passes.
- **Apply needs a metro live.** When live is a graph, apply refuses with "Live is a graph. Run `wren shape convert` first." Why: William 10-21, prod converts fully before G1 lands.
- **Permission.** Apply needs `act` on Journeys (`deals`), the permission every shape write needs today. No new permission. Why: none exists for the shape; `manage` would take apply from operators. Open for William.
- **Author.** `created_by` is the author. No edit log. Why: a draft is one head (business-map design); the version records who applied it.

## Checks and commits (every part)

- While building: `cd packages/pipeline && lockf -s /tmp/wren_automation-checks.lock pnpm -s vitest run <files>`, and `./scripts/gates.sh changed`. Never tsc, turbo or vitest for the whole repo. Integration: only the files you touched.
- Biome format each file. Concise plain English in comments (ASD-STE100), no em dashes. Synthetic test data only: no client names, no amounts.
- Never touch prod.
- `git add` new files, then `git commit -- <paths>`. Message ends with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PpzL4T1jZXndKhYDqy2SGC
```

- Report: shas, what you built, anything you judged differently and why. Leave no process running.
