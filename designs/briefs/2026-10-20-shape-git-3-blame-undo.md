# Brief G3: blame and undo, pure

Design: `designs/2026-10-19-business-map.md`, "History like git", paragraphs "Blame" and "Undo one change". Bead `wa-dcr.1` (the backend's pure part). Worktree `~/worktrees/wren-shape-git-pure`, branch `shape-git-pure`, from branch `shape-git`. Read `packages/pipeline/src/{diff,edit,model,history,blame}.ts` and `diff.test.ts`, `edit.test.ts`, `test/fixtures.ts`.

The signatures are committed and fixed: `historyOf` in `blame.ts`, `undoChange` in `edit.ts`, `BlameLine` in `history.ts`, `ShapeChange` in `diff.ts`. Fill in the bodies; do not change a signature or a type (G1 and G2 code against them now). Touch no other file except the two test files and the map card line below.

## Do

1. **`historyOf(versions, id, on = "node")`** (`blame.ts`): pure. Sort a copy by `number`. Compare each version with the one before it (an empty body before the first), for that one id only:
   - node: `added` (not before, now), `removed` (before, not now), `renamed` (name differs; `from`, `to` set), `changed` (any other field differs: compare with `canonicalJson` of the node with `name` blanked, as `diffShapes` does). A version that renames and changes the node gives two lines, `renamed` first.
   - edge: `added`, `removed`, `changed` (any field differs).
   - Each line: `version`, `how`, `note`, `by` (`createdBy`), `at` (ISO text from `createdAt`, Date or string).
   - Newest first. An id that was removed and added back shows both. An unknown id gives `[]`.
2. **`undoChange(newest, a, b, change)`** (`edit.ts`): pure. The inverse of one change from body `a` to body `b`, applied to `newest`. Use `withNode`, `withEdge`, `withoutNode`, `withoutEdge`. Refused (`Refused`, plain sentences naming the node or edge by name) when `newest` no longer holds what `b` had for that line (git revert's conflict: a later version touched it again; "undo the later change first"):
   - `name`: needs `newest.name === b.name`; puts `a.name` back.
   - node `added`: needs the node in `newest`; removes it and its edges.
   - node `removed`: needs no node with that id in `newest`; adds `a`'s node back, with every edge of `a` that touches it whose other end is in `newest` and whose id is free. Edges left out are fine (the result says what it holds; the caller's diff shows it).
   - node `renamed`: needs the node in `newest` with `b`'s name; puts `a`'s name back, keeps every other field of `newest`.
   - node `changed`: needs the node in `newest` with `b`'s fields (name aside); puts `a`'s fields back, keeps `newest`'s name.
   - edge `added`: needs `newest`'s edge equal to `b`'s; removes it.
   - edge `removed`: needs the id free in `newest` and both ends present; adds `a`'s edge back.
   - edge `changed`: needs `newest`'s edge equal to `b`'s; puts `a`'s back.
   - A change that is not a line of `diffShapes(a, b)` is refused ("That change is not between these versions.").
   - It checks nothing else: the caller runs `checkShape` (the route refuses when it fails). It never mutates its inputs.
3. **Tests** (`src/blame.test.ts` new, `src/edit.test.ts` extended), on `test/fixtures.ts` shapes: every `how` for nodes and edges, rename plus change in one version, removed then re-added, newest first, an unknown id; every undo kind, each refusal (later change, id taken, end missing, not a line of the diff), inputs unchanged after a call, and one round trip: for each change of a diff, undo on `b` itself gives a body whose diff with `b` is exactly the inverse line.
4. **Map card**: one line each for `historyOf` and `undoChange` in `map/objects/platform/shape.md`'s functions list (if it has one). Run `map/_meta/build.sh` then `--check`. G1 edits the same card; keep your lines few and in one place so the fold merges clean.

## Checks and commits

`cd packages/pipeline && lockf -s /tmp/wren_automation-checks.lock pnpm -s vitest run src/blame.test.ts src/edit.test.ts`, then `./scripts/gates.sh changed` once at the end. Never tsc, turbo or vitest for the whole repo. Biome format each file; strings with inner double quotes use single quotes. `git add` new files, then `git commit -- <paths>`. Message ends with:

```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PpzL4T1jZXndKhYDqy2SGC
```

Report: the sha, what you built, anything you judged differently and why. Leave no process running.
