# Briefs D: the Map home on the metro renderer

Design: `designs/2026-10-20-design-language.md`, area D, "UI soundness", and the Decisions (William 10-21, planner D). Prior: briefs `2026-10-20-design-language-b-metro.md` (the renderer) and `-c1.md` (`runOf`, `metroView`, `diffStored`). Drafts: `designs/2026-10-19-business-map.md`. Bead `wa-7oo.8`.

Four parts, four builders, one worktree each under `~/worktrees/wren-shape-d<n>`. Order: D1 and D2 at once. D3b on D2. D3a on a merge of D1 and D3b. Each branch starts from the one before it, so the last tip holds all four.

No migration. Prod stays a graph: every read draws a graph with `metroView` in memory. Never run `wren shape convert` against prod. Never push `shape-c1-held`.

G1 (`shape-g1`, bead `wa-7oo.11`) edits `console.ts`, `console-routes.ts`, `history.ts` and `drafts.ts` too. Keep D1 to the handlers named here. Expect a merge of main before the gate.

## The target in one paragraph

Home `/` draws the live shape with `MetroMap`, on a graph body and a metro body alike. No editor on the web. A draft draws under a banner with its changes marked; Apply and Drop act on it. Every station and track shows its numbers by id. The hub shows the lead count. Today lists person tracks, late first, and hovering a task lights its line. The web never sends a shape body: export, restore, preview and diff all go by ref or text, and every diff answer carries the drawing and the change lines from the server.

---

## D1: server and contract (`packages/pipeline`)

### Contract (`src/history.ts`), pin these

```ts
import type { MetroBody } from "./metro.js";
import type { MetroDiff } from "./metro-diff.js";
import type { StoredDiff } from "./stored.js";

/** One change, as its undo key and a plain line, in `storedChangesOf` order. */
export interface ChangeLine { key: string; line: string }

/** What `shapeDiff` answers: from `a` to `b`. */
export interface DiffAnswer {
  a: ShapeRef;
  b: ShapeRef;
  /** In the stored bodies' terms: graph keys when both are graphs. Undo takes these keys. */
  diff: StoredDiff;
  changes: ChangeLine[];
  /** Both sides as the map draws them. Null when a side cannot be drawn (`metroView` refused). */
  views: [MetroBody, MetroBody] | null;
  /** `diffMetro(views[0], views[1])`: the marks. Null with `views`. */
  marks: MetroDiff | null;
}

/** What `shapeUndoPreview` answers: from the newest version to what the undo would save. */
export interface UndoPreviewAnswer {
  line: string; note: string; newest: number;
  diff: StoredDiff; changes: ChangeLine[];
  views: [MetroBody, MetroBody] | null; marks: MetroDiff | null;
}

/** What `shapePreview` answers: from the newest version to the file. */
export interface PreviewAnswer {
  a: number | null;
  diff: StoredDiff; changes: ChangeLine[];
  views: [MetroBody, MetroBody] | null; marks: MetroDiff | null;
  note: string | null; moves: Moves | null;
}

/** A draft's detail. `body` stays the graph it runs as. */
export interface DraftDetail {
  body: ShapeBody;
  moves: Moves;
  /** The draft as the map draws it; null when it cannot be drawn. */
  metro: MetroBody | null;
  /** Why it cannot be drawn; empty when it can. */
  drawErrors: string[];
}
```

The graph `bodies` go from all three answers. Break the old shape freely; update every reader.

### Handlers (`src/console.ts`)

- One helper `diffAnswerOf(a: StoredBody, b: StoredBody)` gives `{ diff, changes, views, marks }`: `diffStored`, `storedChangesOf` with `storedChangeKey` and `storedChangeLine`, `metroView` of each side (catch `Refused`: `views` and `marks` null; `diff` and `changes` stay). Put it in `stored.ts` (pure) with a unit test.
- `shapeDiff`, `shapeUndoPreview`, `shapePreview` answer through it. A missing side in preview is `{ name, nodes: [], edges: [] }` as today.
- `shapeExport`: input `{ ref?: ShapeRef }` (default the newest version). Answers `exportShape(await bodyOfRef(db, ref))`: the stored body, metro as metro. The `body` input goes. No shape: refused, "This workspace has no shape yet."
- `shapeVersion`: also takes `from: number` in place of `body`: saves the stored body of version `from` (a restore). Exactly one of `body` and `from`, or refused. The CLI keeps `body`.
- `shapeBlame`: takes exactly one of `node`, `edge`, `station`, `track`, `line`, `group` (`historyOfStored` with that `on`).
- Update the request types and `describe` texts beside them.
- Prod converts after D (William, 10-21), then C1 Part 4 refuses graph saves. So:
  - Undo keys follow the newest version's model. When the newest is metro, `diff` and `changes` are the metro diff of `metroView(a)` to `metroView(b)`, even for two graphs. `undoStoredChange` refuses a graph key on a metro newest.
  - Restore with `from: n` on a metro newest saves `metroView(body of n)`. `saveShape` refuses a graph over metro.
  - A graph file imported on a metro newest stays refused, in one plain sentence.

### Records (`src/records.ts`)

- The shape detail adds `drawErrors: string[]` beside `metro` (the `Refused` reasons; empty when it draws).
- The draft detail (`load`, about line 510) answers `DraftDetail` with `metro` and `drawErrors`. A metro draft on a graph live draws as itself; a graph draft draws through `metroOf`.
- A G1 draft holds a metro body while live is a graph. `shapeDiff` of base (graph) to that draft (metro) is a metro diff: `diffStored` converts the graph side in memory. Test it.

### Numbers (`src/numbers.ts`)

- When the newest is a graph and `metroView` draws it, `numberRows` keeps the node and edge rows and adds `metroRowsOf(view, graphRows, offers, f)` after them. When the newest is metro, it stays as today (metro rows only). A refused draw adds nothing.
- The hub station row: `metroRowsOf` adds `{ id: "station:hub", kind: "station", label: "hub", name: <hub label>, nodeKind: "hub", now: <leads> }`, other numbers null. Skip it with a `source` filter.
- Leads (`leadsOf(db)`, one query): profiles with `merged_into` null and no `pipeline.deals` row of any status for that profile. Pipeline imports `profiles` from `@wren/core/profiles-schema`. Pass the count into `metroRowsOf` as a new last argument `leads: number | null`.
- Check every reader of `numberRows` and the `pipeline.number` record (CLI `wren numbers`, `wren shape show`, the web) so each still lists only the kinds it lists today. Filter by kind where a reader lists all rows.

### Agent and CLI

- `apps/portal/web/public/agent/SKILL.md`: if it names `shapeDiff`, `shapeExport`, `shapePreview` or `shapeBlame` with their fields, change it to the new fields. Do not touch the draft lines (G1 owns them).
- `apps/cli`: any caller of the changed answers reads the new fields.

### Tests

- Unit: `diffAnswerOf` on two graphs (graph keys), graph to metro (metro keys), a graph with node `hub` (views null, changes kept). `metroRowsOf` with the hub row and `leads`.
- Integration (only files you touch, `packages/pipeline/test/integration/`): `shapeDiff` between two graph versions answers views and marks; a version against a metro draft answers a metro diff; `shapeExport` by ref on a metro version exports the metro file; `shapeVersion` with `from` saves a copy of that body; `shapeBlame` by station; the draft detail has `metro`; `numberRows` on a graph newest has station and track rows with the same numbers as the node and edge rows; the hub row counts a profile with no deal, and skips a merged one and one with a deal. Synthetic profiles only.
- `map/objects/platform/shape.md` (and the numbers card if one exists): the new fields, with citations. `map/_meta/build.sh`, then `--check`.

---

## D2: renderer (`packages/ui/src/metro`)

No fetching. No pipeline import (`@wren/ui` does not depend on it).

1. **Track ids.** `ViewTrack.id?: string`. When given, the scene track takes it as its id, so `onPick` answers the body's track id. Without it, today's `${from}-${to}`. Tests in `layout.test.ts`.
2. **Diff marks.** `mark?: "added" | "changed" | "removed"` on `ViewStation`, `ViewTrack` and `ViewLine`. Through `layoutMetro` to `MarkStation` and `MetroTrack` (a line's mark goes on each of its tracks and stations that have no mark of their own). CSS in `metro.css` with tokens only:
   - added: the station ring and the track stroke in `--ui-good`; a small `+` tag beside the label.
   - changed: `--ui-warn`; a `~` tag.
   - removed: the mark at 0.45 opacity, the track dashed; a `−` tag. It stays clickable; the panel says it is removed.
   - Each tag has an accessible name ("added", "changed", "removed") in the station's or track's label.
   - Dark mode works from the tokens. Reduced motion changes nothing here.
3. **Legend.** `MetroLegend` (exported from `index.ts`): the three marks with their words, shown only when the view has a mark. A prop `marks: boolean` on `MetroMap` is not needed: `MetroMap` draws the legend itself when any item has a mark, in the controls corner, inside its frame, no layout shift.
4. **Numbers.** Check that `sub` renders on every station kind, the hub included (its count under its label). If the hub does not draw `sub`, make it. `now` stays for capsules.
5. **Line key.** Export `lineKeyOf(view, lineId): string` (the value `lit` and `data-l` take: `"out"` for an outreach line, the id for the rest). D3b uses it.
6. **Stories** (`metro.stories.tsx`): "Diff marks" (one of each, on stations, tracks and a whole line), "Hub count", "Picked track id". Each has a play: the tags are in the accessible tree, a pick on a track answers its `id`. Axe passes. No pixel compare.

---

## D3b: Today tasks (`apps/portal/web/src`)

1. `map/tasks.ts`, pure, with `tasks.test.ts`:

```ts
export interface Task {
  /** The track id. */
  id: string;
  /** The to-station's label: what the owner does. */
  name: string;
  owner: string;
  /** Initials from the owner, for the avatar. */
  initials: string;
  /** The line the track sits on, and its name. */
  line: string;
  lineName: string;
  /** The from-station's label. */
  at: string;
  /** People waiting now: open journeys at the from-station. */
  waiting: number;
  /** Median hours waited, null with none. */
  medianHours: number | null;
  promise: string | null;
  /** Hours in the promise, null with none. */
  promiseHours: number | null;
  /** True when any person has waited longer than the promise. */
  late: boolean;
}
export function promiseHours(p: string): number | null; // "30m" 0.5, "4h" 4, "2d" 48; else null
export function waitsOf(track: MetroTrack, people: readonly Person[], now: Date): { waiting: number; medianHours: number | null; late: boolean };
export function tasksOf(metro: MetroBody, people: readonly Person[], now: Date): Task[];
```

   - A task is a track with `by: "person"` and an owner. Waiting = `Person.node === track.from`, hours from `movedAt`. A track that leaves the hub has no waiting people (the hub holds no one): it lists with 0.
   - Order: late first, then most waiting, then name.
   - The line of a track: the line of its to-station; out to the hub: the from-station's line.
   - `waitsOf` is the one rule for late. The map's `late` mark (D3a) calls it too.
2. `map/TodayTasks.tsx`: the task card of artifact section 07 (`designs/2026-10-20-design-language/design-language.src.html`, lines 391-418 and the script at 813-822): avatar with initials, task name, "<line name> · <n> waiting at <station>", and a pill "Late · promise 4h, median 6h" (bad tint) or "Promise 4h". Props: `tasks`, `onLight(line: string | null)` on hover and focus, `onOpen(id)` on click. Empty: "No tasks waiting." Tokens only, `@wren/ui` parts where they fit.
3. `MapData` (`map/model.ts`, `map/read.ts`) gains `metro: MetroBody | null` and `drawErrors: string[]` from the shape detail. No other change to `readMap` here.
4. `map/Home.tsx`: the tasks go at the top of the Today sheet and the phone Today tab. Home holds `lit` state and passes `lit` and `onOpenTask` to `MapPage` as props (MapPage ignores them until D3a). The line key comes from `lineKeyOf` (D2) on the view D3a builds; until then pass the line id.
5. Story `TodayTasks` in `pages-map.stories.tsx` (or its own file): three tasks, one late. Play: the late one is first, hover calls `onLight` with its line. Axe passes.

---

## D3a: the Map page (`apps/portal/web/src/map`)

### The view

`map/view.ts`, pure, with tests. `viewOf(metro: MetroBody, numbers, people, now, marks?: MetroDiff, removed?: MetroBody): MetroView`:

- Lines, stations, groups, columns from the body. Track `id` = the body's track id.
- Station `sub`: "<now> now · <median> d" from its `station` row; the hub: "<leads> leads". No row: no sub.
- Track `late` from `waitsOf` (D3b). `owner`, `promise` from the body.
- With `marks`: each added or changed id gets its mark. With `removed` (the older side), each removed station, track and line is added back with `mark: "removed"`, so the diff draws in one map.

### The page

Rewrite `MapPage.tsx` on `MetroMap`. Keep the URL contract of `routes.ts`.

- **Read.** `useMap` reads `detail.metro`. `readMap` asks numbers of kind `station`, `track`, `line` (not `node`, `edge`). `metro` null: the map area says "This shape cannot be drawn on the map." with each `drawErrors` line. No shape: `NoShape` as today.
- **Delete edit mode.** `?edit=1` goes from `routes.ts`. Delete `EditPanel.tsx`, `edit.ts`, `edit.test.ts`, `Draft.tsx`, `DraftExits.tsx`, the palette, `SaveDialog`, `SaveAsDraftDialog`, `diff.ts` and `diff.test.ts` (`diffGraph`, `diffLines`), and `graphOf`, `LOOK` in `model.ts` once nothing reads them. Drafts come from the CLI and agents (G1).
- **Panel.** A pick on a station or track opens `NodePanel` for that id (station id = node id, track id = edge id; `opensOf` maps it). The hub opens a short panel: the lead count and a link to People. A line opens its `line` row. A group opens its fold (the renderer does).
- **Draft view** (`?draft=<id>`). Read the draft detail and `shapeDiff` (`a` = the draft's base, `b` = `draft:<id>`). Draw `viewOf(detail.metro, …, marks, views[0])`. A banner over the map: name, "from v<base>", author (`createdBy`), state; when the newest version is past the base, "Live moved to v<n> since". Actions: Apply and Drop as `DraftList.tsx` does today (Apply opens the dialog that shows base to live when live moved, as today; a refusal shows each line of the server's reason). Propose for a draft in state `draft`. Leaving the banner goes to `/`.
- **History.** Compare draws on the map through `viewOf` with marks and the change list from `changes` (each with its Undo, key from `changes[].key`). `views` null: lines only, no marks. Restore calls `shapeVersion` with `from: n`. Blame asks `station`, `track`, `line` (`useBlame`).
- **Export.** `shapeExport` with `ref` (the shown version, or `draft:<id>`). **Import.** The preview draws `views` with `marks`; its list is `changes`.
- **⌘K.** `stations.ts` lists the metro stations (label, id) from the shape detail.
- **Today.** `lit` and `onOpenTask` from Home: `lit` goes to `MetroMap`; a task opens its track panel.
- **Per-viewer state.** Zoom, fold level and the open panel persist across navigation (`useLocal` or the URL as the page does today).
- **Loading** (section 14): `BusyBox` on first load of the map; old data stays on refresh with `Busy` beside the title; error is one sentence and Retry. No bars. TanStack Query (`useCall`) only.
- **No body on the wire.** After D3a, `git grep -n "body" apps/portal/web/src/map` finds no call that sends a shape body. Say so in the report.

### Every surface after the convert

The convert is next (William, 10-21). Each web surface that reads the shape must work on a converted body. The shape detail's `body` stays `runOf` (the graph the runtime runs) after the convert; `metro` is the stored metro body.
- `modules/deals/board.tsx` reads `detail.body.nodes` (columns by `pathOf`). It keeps working on the lowered graph. Add a story or test on the converted mock.
- Map, History, Import, Undo, ⌘K, NodePanel, Today: on `metro` and the D1 answers only.
- `git grep -nE "body\.(nodes|edges)" apps/portal/web/src` after D3a: each hit reads `detail.body` as the runtime graph, never a body sent to the server. List the hits in the report.

### Mocks and stories

- The mock shape is the convert of the synthetic mock graph: `metro = metroOf(graph).body`, `body = graphOf(metro)` (`@wren/pipeline/convert`), as prod after `wren shape convert --write`. Keep one "graph live" mock as well (`metro` drawn by `metroOf`, `body` the graph) for the time before the convert.

- `mocks/data/map.ts` and `map-drafts.ts`: answer the D1 contract (metro detail, `views`, `marks`, `changes`, `drawErrors`, numbers of kind station, track, line, the hub row). Synthetic names only.
- `pages-map.stories.tsx`: delete the edit-mode stories. Keep or rewrite: home, panel open, draft view (banner, marks, Apply, Drop), history compare, export (asserts `MAP_CALLS` has `shapeExport` with `ref` and no `body`), import preview, cannot draw, phone. Plays and axe on each.

---

## Checks and commits (every part)

- While building: D1 `./scripts/gates.sh changed` and `cd packages/pipeline && lockf -s /tmp/wren_automation-checks.lock pnpm -s vitest run <files>` (integration files you touch only). D2, D3a, D3b `./scripts/gates.sh ui`. Never tsc, turbo or vitest for the whole repo.
- Biome format each file. Comments in concise plain English (ASD-STE100), no em dashes. Synthetic data only: no client names, no amounts, no lead data.
- Never touch prod. Never scan or screenshot the live portal.
- `git add` new files, then `git commit -- <paths>`. Message ends with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PpzL4T1jZXndKhYDqy2SGC
```

- Report: shas, what you built, what you skipped and why, anything you judged differently. Leave no process running.
