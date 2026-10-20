# Brief G1: history like git, backend

Design: `designs/2026-10-19-business-map.md`, section "History like git (William, 2026-10-20)", and its "Decisions" (the 2026-10-20 bullets). Bead `wa-dcr.1`. Worktree `~/worktrees/wren-shape-git-backend`, branch `shape-git-backend`, from branch `shape-git` (main plus the contract commit). Read card `map/objects/platform/shape.md` first, then `packages/pipeline/src/{store,diff,edit,shape-file,schema,console,console-routes,records,components,history}.ts`, `apps/cli/src/shape.ts`, `packages/content/src/blog.ts`.

The contract is committed and fixed: `packages/pipeline/src/history.ts` (route and record types), `diff.ts` (`ShapeChange`, `changesOf`, `changeKey`, `parseChangeKey`, `changeLine`, `changeLines`). The UI builder (G2) codes against them now. Do not change a type there; if one is wrong, say so in your report and add a field only (never rename or remove). `blame.ts` `historyOf` and `edit.ts` `undoChange` are stubs that brief G3 fills in another worktree. Call them as they are; your unit tests must not depend on their bodies (G3 tests them). Your integration test for undo may fail until G3 is folded in: mark it `it.todo` only if it does, and say so.

## Goal

Drafts, proposals, tags and the git mirror in the store, the console routes, the records, the CLI and the agent SKILL. Blame and undo wired as routes and CLI over G3's pure functions.

## Do

1. **Schema and migration 0309** (`packages/pipeline/src/schema.ts`, `packages/db/drizzle/0309_*.sql`, journal and snapshot regenerated as 0308 did):
   - `pipeline.shape_drafts`: `id` varchar(40) PK, `name` text, `body` jsonb ShapeBody, `moves` jsonb default `{}`, `base` integer FK to `shape_versions.number` (indexed), `note` text not null default `''`, `state` varchar `oneOf(DRAFT_STATES)` default `draft`, `created_by`, `created_at`, `updated_at`, `applied_version` integer FK to `shape_versions.number` (indexed), `decided_by`, `decided_at`, `drop_reason`.
   - `shape_versions.draft` varchar(40) nullable, FK to `shape_drafts.id`, indexed. Adding a column does not fire the `never_edited` trigger.
   - `pipeline.shape_tags`: `name` text PK (1 to 60 characters, trimmed), `version` FK (indexed), `note` text null, `created_by`, `created_at`. The `pipeline.never_edited()` trigger on it, as `shape_versions_never_edited` (tags are immutable).
   - `pipeline.shape_mirrors`: `version` integer PK and FK to `shape_versions.number`, `repo` text, `path` text, `sha` text, `at` timestamptz default now.
   - The schema test wants every FK column indexed. `./scripts/gates.sh schema` checks drift.
2. **GitHub helper** moves to `packages/core/src/github.ts` (export `./github` in core's package.json): `githubRepo({ token, repo, branch?, fetch? })` as today (read, write with sha, "unchanged text commits nothing"), the interface renamed `GithubFiles`, user agent `wren`. Add `lastCommit(path): Promise<string | null>` (`GET /repos/<repo>/commits?path=<path>&sha=<branch>&per_page=1`). Move its test from `packages/content/src/blog.test.ts` to `packages/core/src/github.test.ts` and add one for `lastCommit`. `blog.ts`, `restate/blog.ts` and `apps/worker/src/services.ts` import from core; the blog works as before (its tests pass). No re-export shim in content.
3. **Config** (`packages/config/src/index.ts`): `shapesGithubToken: "WREN_SHAPES_GITHUB_TOKEN"` (optional) and `shapesGithubRepo: "WREN_SHAPES_GITHUB_REPO"` (default `wrenautomation/sops`), beside the lander keys. If the Lambda's env or the SSM key list is filtered by a list in the repo (grep `WREN_LANDER_GITHUB_TOKEN` across `deploy/`, `scripts/`, `.github/`), add the new names there too. Setting the token on prod is the main session's (wa-dcr.3), not yours.
4. **Drafts** (`packages/pipeline/src/drafts.ts`, all writes through `atomic`, a lock per draft id like `store.ts`'s `lock`):
   - `draftIdOf(name)`: lowercase letters, digits and dashes, starts with a letter, at most 40. Empty: refused "The draft needs a name."
   - `newDraft(db, { name, body, moves?, base?, note?, by })`: `base` defaults to the newest version; refused when the workspace has no shape ("Start or import a shape first.") or `base` is no version. Refused when the id is taken by any draft, in any state: `A draft "<id>" exists. Pick another name.` The body is not checked here (a draft may be half done); apply checks it.
   - `updateDraft(db, { id, body, moves?, note?, by })`: overwrites body and moves (and note when given), sets `updated_at`. Refused unless state is `draft` or `proposed`. State stays.
   - `proposeDraft(db, { id, by })`: `draft` to `proposed`; refused otherwise.
   - `applyDraft(db, { id, by, triggers })`: one transaction: lock the draft, refuse unless `draft` or `proposed`, then `saveShape(tx, { body, moves, note: draft.note || "Draft <name>", by, triggers, draft: id })`, then state `applied`, `applied_version`, `decided_by`, `decided_at`. `saveShape`'s refusals (checkShape, "Nothing changed.") pass through and the draft stays as it was.
   - `dropDraft(db, { id, by, reason })`: reason required ("Say why."); `draft` or `proposed` to `dropped` with `decided_by`, `decided_at`, `drop_reason`.
   - `saveShape` gains an optional `draft` field that it writes to `shape_versions.draft`.
5. **Tags** (`store.ts` or `tags.ts`): `addTag(db, { name, version, note?, by })`: name trimmed, 1 to 60 characters; refused when the version does not exist or the name is taken (`The tag "<name>" is on version <n>.`). `tagsOf(db)`.
6. **Mirror** (`packages/pipeline/src/mirror.ts`):
   - `mirrorShapes(db, { files: GithubFiles | null, repo: string, workspace: string, log? })`. Path `shapes/<workspace>.yaml`: workspace `wren` for the main DB, the client id otherwise. With `files` null: returns `{ off: true }` and logs one info line per process ("shape mirror off: WREN_SHAPES_GITHUB_TOKEN is not set").
   - It commits every version with no `shape_mirrors` row, oldest first, holding `pg_advisory_xact_lock(hashtext('shape mirror'))` in one `atomic` for the run, so two runs never interleave and git log keeps number order. The file is `exportShape(body)`. Message: first line `shape <workspace> v<n>: <note>`, blank line, `Author: <created_by>`. The row gets the commit sha; when `write` answers null (the file already held that text), the sha is `lastCommit(path)`. It stops at the first failure, so a later version never lands before an earlier one; the next run picks up from there.
   - It never throws: it returns `{ committed: { version, sha }[], failed?: string }` and logs the failure with `console.warn`. A failed mirror never fails a save.
   - Rows only on success. The same function is the backfill: the first live save on prod (Wren v1, v2 have no rows) commits v1, v2 and the new one, in order.
7. **Console routes** (`console.ts`, `console-routes.ts`, the input schemas with zod `describe` like the others; every route reads the workspace with `workspace(req, need)`; refusals through `refused`). Exactly these names and types from `history.ts`:

   | Route | Need | Takes | Answers |
   |---|---|---|---|
   | `shapeDraftNew` | act | `DraftNewAsk` | `DraftNewAnswer` |
   | `shapeDraftUpdate` | act | `DraftUpdateAsk` | `DraftUpdateAnswer` |
   | `shapeDraftPropose` | act | `DraftIdAsk` | `DraftStateAnswer` |
   | `shapeDraftApply` | act | `DraftIdAsk` | `DraftApplyAnswer`, then the mirror step |
   | `shapeDraftDrop` | act | `DraftDropAsk` | `DraftStateAnswer` |
   | `shapeDiff` (changed) | read | `DiffAsk`: `a`, `b` each a number or `draft:<id>` | `DiffAnswer` (echoes the refs) |
   | `shapeBlame` | read | `BlameAsk` (exactly one of node, edge) | `BlameAnswer` from `historyOf` over every version |
   | `shapeUndoPreview` | read | `UndoAsk` | `UndoPreviewAnswer`; refused (400) with every reason when `parseChangeKey` fails, `undoChange` refuses, or `checkShape` on the result fails |
   | `shapeUndo` | act | `UndoAsk` | `UndoAnswer`, saved with note `Undo: <changeLine>`, then the mirror step |
   | `shapeTag` | act | `TagAsk` | `TagAnswer` |

   - Undo of "node added" while open journeys sit on that node is refused like `wren shape remove` (`openOn`): "<n> open journeys sit on <id>. Move them first."
   - The writes go in `PIPELINE_CONSOLE_WRITES`; update `test/integration/console.test.ts`'s route lists.
   - **Mirror step**: `shapeVersion`, `shapeImport`, `shapeStart`, `shapeDraftApply` and `shapeUndo` run `ctx.run("shape mirror", () => api.mirror(req))` after their save step, only when the save succeeded. `PipelineConsoleDeps` gains `shapes?: { files: GithubFiles; repo: string } | null`; `apps/worker/src/services.ts` builds it from `shapesGithubToken` and `shapesGithubRepo` (null without the token). `api.mirror` is the workspace (read) plus `mirrorShapes`, and returns its result.
8. **Records** (`records.ts`, `components.ts`):
   - `pipeline.shape` detail: `versions` become `VersionLine[]` (add `draft`, `tags`, `mirror` with `url` `https://github.com/<repo>/commit/<sha>`). Rows unchanged. Actions add the new routes.
   - New `SHAPE_DRAFT_RECORD = "pipeline.shape_draft"`, `app: "deals"`, rows `DraftRow` (camelCase on the wire, as the others), key `id`, title `name`, subtitle `note`, `state` as a status field (draft neutral, proposed warn, applied good, dropped neutral). Views `open` (draft or proposed, default), `proposed`, `all`, sorted `-updatedAt`. Detail (`load`) is `DraftDetail`. Actions: the five draft routes. Add it to `PIPELINE_RECORDS` and to the component's `records` (every record type has one owner; `apps/worker/src/components.test.ts` checks it).
9. **CLI** (`apps/cli/src/shape.ts`, wired in `main.ts`). `ShapeDeps` gains `mirror: (db: Db) => Promise<MirrorResult>` (workspace from `--client`, else `wren`) and what `--all` needs (main db, `listClients`, open each client db). Every CLI save (import, start, add-node, connect, remove, draft apply, undo) mirrors after the write and prints one line: `mirrored v<n> <sha7>`, `mirror off`, or `mirror failed: <why>`.
   - `wren shape draft new <file> --name <name> [--note <why>]` (a shape file; its `moves` and `note` come along), `draft list [--state <s>]`, `draft show <id>` (the draft's diff against live, one line each), `draft propose <id>`, `draft apply <id>`, `draft drop <id> --reason <why>`.
   - `wren shape blame <id> [--edge]`: one line per version, newest first: `v<n>  <day>  <by>  <how>  <note>`.
   - `wren shape diff <a> <b>` prints each line's `changeKey` at its end in brackets. `wren shape undo <a> <b> <change> [--preview]`.
   - `wren shape tag <name> <version> [--note <why>]`, `wren shape tags`. `wren shape versions` shows tags and the short sha.
   - `wren shape mirror [--all]`: this workspace, or Wren's and every client's. Prints each workspace's commits.
   - Tests in `apps/cli/src/shape.test.ts` as the others are written.
10. **Agent**: `apps/portal/web/public/agent/SKILL.md`'s shape section gains the draft, propose, blame, undo (preview first) and tag calls, and "an agent proposes; a person applies in the Map". Agents never call `shapeDraftApply` unless William asked.
11. **Map cards**: `map/objects/platform/shape.md` (drafts, tags, mirrors, the routes, the mirror's GitHub seam: "outside the tree" names the private sops repo), the core card that lists core's modules if one does (github.ts), `map/objects/platform/content` card if it names `githubRepo`. Run `map/_meta/build.sh` then `map/_meta/build.sh --check`.

## Tests

- Unit: `draftIdOf`; `mirrorShapes` against a fake fetch (commits oldest first, message format, stops at the first failure and writes rows only for what landed, off without files, null write uses `lastCommit`) using the pipeline's integration DB if it needs rows; `github.test.ts`.
- Integration (`packages/pipeline/test/integration/drafts.test.ts`, run from the package dir with `lockf -s /tmp/wren_automation-checks.lock pnpm -s vitest run test/integration/drafts.test.ts`; Docker `wren-postgres-1` is up): new, taken id refused, update, propose, apply carries open journeys (an open journey on a node the draft keeps lands on the new version; a `moves` entry remaps), apply refused by `checkShape` leaves the draft `proposed`, drop needs a reason, applied version has `draft` set; tags immutable (update refused by the trigger) and unique; the console routes through `pipelineConsoleApi` (`shapeDiff` with `draft:<id>`).
- Synthetic data only: no client names, no amounts, no real repo names in fixtures except the default config value.

## Not

- No UI files (`apps/portal/web/src/**` except `public/agent/SKILL.md`). G2 owns them.
- No `blame.ts` or `undoChange` bodies. G3 owns them.
- No draft branches in git (the design's next step). No merge.
- Nothing against prod, no token set, no push.

## Checks and commits

While you build: `./scripts/gates.sh changed` and single test files as above; `./scripts/gates.sh schema` once after the migration. Never tsc, turbo or vitest for the whole repo. Biome format each file (`pnpm -s biome format --write <file>`); strings with inner double quotes use single quotes. `git add` new files, then `git commit -- <paths>`. Small commits are fine. Messages end with:

```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PpzL4T1jZXndKhYDqy2SGC
```

Report: the commit shas, what each does, what you skipped and why, any contract field you added. Leave no process running.
