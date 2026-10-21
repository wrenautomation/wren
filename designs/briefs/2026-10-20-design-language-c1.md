# Briefs C1: the shape model inversion

Design: `designs/2026-10-20-design-language.md`, area C1, "Order and push policy" and "Decisions (planner, 2026-10-20)". Source of truth: `designs/2026-10-20-design-language/design-language.src.html` sections 04, 05, 09 and 11. Prior model: `designs/2026-10-19-business-map.md`. Bead `wa-7oo.6`.

Worktree `~/worktrees/wren-shape-c1`, branch `shape-c1`, from `origin/main` (b10e717a). One builder at a time. Each part is one or more commits. Parts 1 to 3 are additive and pushable. Part 4 is HELD: commit it, never push it.

Read first: `packages/pipeline/src/{model,diff,blame,edit,undo,store,journeys,shape-file,mirror,workflow,numbers,records,history}.ts`, `packages/pipeline/test/fixtures.ts`, `starter.yaml`, `map/objects/platform/shape.md`.

## The target in one paragraph

A body with `model: "metro"` is the new model. A body without `model` is today's graph. Both are valid stored bodies. The runtime (workflow, moves, entry, steps, carry, numbers) keeps the graph: it reads `runOf(stored)`, which lowers a metro body to a graph with `graphOf`. Readers that show the map (CLI, records, blame, diff, YAML) read `metroView(stored)`. Ids are identities: station id = node id, track id = edge id, outreach line id = source id. So journeys, deals, `journey_research` and the trail need no remap. Prod stays a graph until William says yes to `wren shape convert --write`.

## Types (`packages/pipeline/src/metro.ts`)

Field names match the renderer view in `packages/ui/src/metro` (`label`, `kind`, `line`, `column`, `tier`, `colour`, `from`, `to`, `by`, `owner`, `promise`).

```ts
export const HUB = "hub";
export const TIERS = ["out", "front", "core"] as const;
export const COLUMNS = ["marketing", "sales", "delivery", "money"] as const;
export const STATION_KINDS = ["att","time","cash","exit","hub","condition","race","split","join","ab","approval","link"] as const;
export const LOGIC_KINDS = ["condition","race","split","join","ab","approval","link"] as const;
export const TRACK_KINDS = ["exit", "xfer", "back"] as const; // none: a plain track
export const ATTACH_KINDS = ["sop","link","page","funnel","doc","template","note"] as const; // part 3

export interface LineEntry { via: Via; channel?: string; campaign?: string; source?: string; segment?: string; parked?: true }
export interface MetroLine {
  id: string; label: string; tier: Tier;
  offer?: string;        // registry offer id; never on an out line
  colour?: number;       // line token index 0..7; never on an out line (out draws grey)
  entry?: LineEntry;     // out lines only, required there: today's source fields (group is now segment)
  planned?: true;
  attach?: Attach[];     // part 3
}
export interface MetroStation {
  id: string; label: string; kind: StationKind;
  line?: string;         // required, except on the hub; optional on an exit
  column: Column;
  action?: Action;       // att and time stations only; kind must equal kindOfAction(action)
  advance?: Advance[]; research?: Research; idleDays?: number;
  deal?: true;           // a deal opens here (today's offer node); its offer is the line's offer
  terms?: string;        // cash: the plan slug (today's plan node)
  offer?: string;        // cash: the offer it points at; none: the line's offer
  failure?: true;        // exit: red
  rule?: string;         // join: "all", "any" or "<n> of <m>"
  flow?: string;         // link: the shared flow id (part 3 checks it exists)
  retries?: number;      // retry chip: the cap, 1..10
  planned?: true;
  attach?: Attach[];     // part 3
}
export interface MetroTrack {
  id: string; from: string; to: string;
  line?: string;         // the line it is drawn in: required on a plain track; on xfer the line it joins
  kind?: TrackKind;      // none: plain; back: today's loop (crossing it opens a new journey)
  by: "system" | "person";
  owner?: string;        // person tracks only, 40 characters at most
  promise?: string;      // person tracks only, a duration: /^\d+[mhd]$/
  entries?: string[];    // hub tracks only: the out lines whose people take it; none: all
  cond?: string;         // branch label, 4 words at most
  else?: true;           // the else branch of a condition
  wait?: string;         // race: the clock branch, a duration
  weight?: number;       // ab arm, whole percent
  label?: string;        // xfer (upsell, downsell, cross-sell) or back ("after 90 days")
  planned?: true;
}
export interface MetroGroup { id: string; label: string; line: string; stations: string[]; attach?: Attach[] }
export interface MetroFrame { id: string; label?: string; stations: string[]; trigger: Advance; exit: string }
export interface MetroBody {
  model: "metro"; name: string;
  lines: MetroLine[]; stations: MetroStation[]; tracks: MetroTrack[];
  groups: MetroGroup[]; frames: MetroFrame[];
  flows?: MetroFlow[];   // part 3
}
```

`kindOfAction`: comment, reply, dm, email, text, cta, visit, form, proposal, signed and other are `att`; call, book and held are `time`.

Hold and version chips are numbers read at run time, not stored fields.

---

## Part 1: pure metro layer

New files only, plus `Refused` moved to `src/refused.ts` (re-exported from `store.ts`, no other change) so pure files can throw it. No file imports `@wren/db` here.

1. **`metro.ts`**: the types above, `isMetro(body)`, `kindOfAction`, `checkMetro(body, ctx: ShapeCheckContext): string[]`. Plain-English errors, every one found:
   - Name set. Ids: `STAGE_KEY`, at most `NODE_ID_MAX`, unique within each list (lines, stations, tracks, groups, frames). A line and a station may share an id. Station id `dropped` is reserved. Exactly one station of kind `hub`, and its id is `hub`; no other station uses `hub`.
   - Lines: tier known. Out lines: `entry` with a known `via`, no `offer`, no `colour`. Front and core: no `entry`; `colour` a whole number 0 to 7 when set. An `entry.segment` names an active segment (`ctx.group`); `entry.source` names an import (`ctx.source`), as `checkShape` does for sources. Share the helpers with `checkShape` (extract them in `model.ts`; `checkShape`'s output must not change).
   - Stations: kind and column known; `line` exists (required except hub; optional on exit); the hub has no line. `action` only on att or time, and `kind === kindOfAction(action)`. Advance triggers known (`ctx.triggers`). `idleDays` 1 to `IDLE_DAYS_MAX`. `deal` only on a non-cash station of a line with an `offer`; at most one deal station per line. `terms` only on cash. `failure` only on exit. `rule` only on join. `flow` only on link, and a link needs it. `retries` a whole number 1 to 10.
   - Tracks: `from` and `to` exist and differ. `by` known; `owner` and `promise` only when `by` is `person`; durations match `/^\d+[mhd]$/`. A plain track needs `line`, which exists. `exit` goes to an exit station. `xfer` joins two stations on different lines, and `line` is the line of `to`. An exit station has no out-tracks.
   - The hub: tracks into it come only from out-line stations; tracks out of it go only to stations on front or core lines. A track from an out-line station to any other line goes through the hub. `entries` only on tracks out of the hub, each an out line.
   - Logic: condition has 2 or 3 out-tracks, exactly one `else`, the others a `cond` of 4 words or fewer. Race has 2 or more out-tracks, exactly one with `wait`, the others a `cond`. Split has 2 or more out-tracks. Join has 2 or more in-tracks and a `rule` of `all`, `any` or `<n> of <m>` where `m` is its in-track count and 1 <= n <= m. AB has 2 or more out-tracks, each a whole `weight` 1 to 99, summing to 100. `cond`, `else`, `wait` and `weight` appear only on those stations' out-tracks.
   - No cycle over plain and xfer tracks (back tracks are the way back). Along every plain and xfer track the column never goes left (`COLUMNS` order).
   - Groups: label, line exists, at least one station, each on the group's line, no station in two groups, never the hub or an exit.
   - Frames: at least one station, all exist; trigger known; `exit` is an exit station.
2. **`placesOf(body: MetroBody): Record<string, number>`** (`metro.ts`): each station's place left to right, the successor of `depthOf`. Walk stations in column order, then topological order over plain and xfer tracks. A station's place is the larger of (1 + the largest place of its in-tracks' `from`) and (1 + the largest place in every earlier column); a station with neither is 0. Pure, safe on an unchecked body (skip unknown ids, never loop for ever).
3. **`convert.ts`**: `metroOf(graph: ShapeBody): { ok: true; body: MetroBody; notes: string[] } | { ok: false; errors: string[] }` and `graphOf(metro: MetroBody): ShapeBody`, plus `lowerable(metro): string[]` (why `graphOf` cannot run it; empty when it can). Pure. The rules are in the design doc's planner Decisions; in short:
   - A node id `hub` refuses the convert.
   - Each source becomes an out line (id = source id, label = name, `entry` from via, channel, campaign, source, `group` as `segment`, parked) with one start station (same id, kind att, column marketing) and a track `<src>_to_hub` (system).
   - The hub: `{id: "hub", kind: "hub", label: "First touch", column: "marketing"}`.
   - Each source flow edge `src -> t` becomes an entry on the track `hub_to_<t>` (one per distinct t, `entries` = the sources in node order, line = t's line, by system). A source edge with a label or a non-default id: the label or id is lost; say so in `notes`.
   - Each offer node becomes a line (id = offer node id, label = name, `offer`, tier core, colour = its index among offer lines mod 8) and a station on it (same id, kind att, `deal: true`, column sales, advance, research, idleDays kept).
   - Each plan node becomes a cash station (same id, `terms`, `offer` = the registry offer of the offer node above it, column money) on that offer's line.
   - Each step becomes a station (same id, kind from its action, advance, research, idleDays kept). Its line: the nearest deal station downstream by flow path (tie: line order); else the nearest deal station upstream; else a front line `unrouted` (label "Not on an offer", no offer; a free id if taken). Its column: comment, reply, dm, email, text, cta and visit are marketing; others are sales; downstream of a deal station, delivery. Then lift each column so it never goes left along a flow edge.
   - Each non-source flow edge becomes a track with the same id and label: plain on the to-station's line, or `xfer` when the two ends sit on different lines. Each loop edge becomes a `back` track with the same id and label. `by` is system when the to-station has an advance trigger (a node's `advance` is what moves a journey into it), else person.
   - Groups and frames: none. `name` kept.
   - `graphOf` is the exact inverse: out lines back to source nodes, `entries` back to source edges `<src>_to_<t>`, deal stations to offer nodes, cash stations with terms to plan nodes, the rest to steps, tracks back to edges. Metro-only fields drop. Output order is fixed (sources in line order, then stations in body order; edges in track order) and must never change for a stored body: Restate replays `shape.v<n>`.
   - `lowerable` refuses what the runtime does not run yet: logic stations, exit stations and exit tracks, frames, an out line with other than one station (its own id), a cash station without terms, a deal station on a line without an offer.
4. **`metro-diff.ts`** (pure): `MetroChange = {on: "name"} | {on: "line" | "station" | "track" | "group" | "frame"; id; how: "added" | "removed" | "renamed" | "changed"}`. `renamed` is a `label` change (lines, stations, groups); `changed` any other field. `diffMetro(a, b)`, `metroChangesOf`, `metroChangeKey` (`name`, `station:<id>:<how>`, and so on; the prefixes never clash with `node:` and `edge:`), `parseMetroChangeKey`, `metroChangeLine` (one plain line per change, as `changeLine`). Use `canonicalJson` from `diff.ts`.
5. **`historyOfMetro(versions, id, on)`** (`metro-blame.ts`): as `historyOf`, for metro bodies and the five `on` values. Same `BlameLine` out.
6. **`undoMetroChange(newest, a, b, change)`** (`metro-edit.ts`): as `undoChange`, same refusal rules (not a line of the diff; a later change; an id taken; an end missing). A removed station comes back with every track of `a` that touches it whose other end is in `newest` and whose id is free, and back into its old group when that group still exists. A removed line comes back alone. Never mutates inputs. The caller runs `checkMetro`.
7. **`metro-file.ts`** (pure): `exportMetro(body)` as YAML (`model: metro` first, then name, lines, stations, tracks, groups, frames; keys in the `FIRST` order of `shape-file.ts`, which you may export) and `parseMetroBody(doc)`: structure only (types of fields), every reason found, `Refused`.
8. **Tests** (`src/metro.test.ts`, `src/convert.test.ts`, `src/metro-diff.test.ts`, `src/metro-edit.test.ts`; synthetic data only). Add to `test/fixtures.ts`: `metroShape()` (a hand-made metro body with every station, track and logic kind) and `wideShape()` (a graph like a real business: eight social sources into one comment step, a DM source into the dm step, an ads source into a visit step, a partner source straight to the offer node, a chain comment, reply, dm, cta, visit, book, held, proposal, offer, two plans, and loop edges from five steps back to dm with a label). Must hold:
   - For the starter, `shape()`, every fixture in `test/fixtures.ts` and `wideShape()`: `metroOf` is ok; `checkMetro` of it is empty; `lowerable` is empty; `graphOf(metroOf(g))` equals `g` (`canonicalJson`, nodes and edges sorted by id) when `notes` is empty; every holding node is a station with the same id; every non-source edge is a track with the same id; `shapeWorkflow(1, graphOf(metroOf(g)), scope)` equals `shapeWorkflow(1, g, scope)` (sort nodes and edges by id).
   - `placesOf(metroOf(g))` orders the holding nodes as `depthOf(g)` does, ties aside, on the starter and `wideShape()`. List any difference in the test name if one is right.
   - `checkMetro` refuses each rule above with its own case. `metroShape()` passes.
   - Diff, blame and undo: every `how` on every `on`; rename plus change in one version; removed then re-added; a station's history runs back through versions made by `metroOf` from graph versions (identity ids); each refusal; inputs unchanged; the round trip (undo each change of a diff on `b` gives a body whose diff with `b` is the inverse line).
   - YAML: `parseMetroBody(parse(exportMetro(x)))` equals `x` for `metroShape()` and `metroOf(wideShape())`.
9. `package.json` exports: `./metro`, `./convert`, `./metro-diff`, `./metro-file`, `./metro-edit`, `./metro-blame`, `./refused`.

---

## Part 2: the stored body, callers and the CLI

0. **Fix from Part 1**: `metroOf` sets `by` from the to-station's `advance`, not the from-station's (a node's `advance` is what moves a journey into it). Update its tests.
1. **`stored.ts`**: `type StoredBody = ShapeBody | MetroBody`; `runOf(stored): ShapeBody` (graph as is; metro through `graphOf`); `metroView(stored): MetroBody` (metro as is; graph through `metroOf`, which must not fail on a body `checkShape` accepts); `placesOfStored(stored)` (`depthOf` for a graph, `placesOf` for metro).
2. **Schema types**: `shape_versions.body` and `shape_drafts.body` become `$type<StoredBody>()`. No migration. Let the typecheck find every reader. Runtime readers (journeys `versionOf`, `bodyOf`, `shapeWorkflowsOf`, moves, entry, steps, carry, numbers, worker, core, research, delivery) read `runOf(...)`. Keep `ShapeBody` as the runtime type; do not change its fields.
3. **Store**: `saveShape` takes a `StoredBody`. A metro body: `checkMetro(body, ctx)`, then `lowerable`, then `checkShape(graphOf(body), ctx)`; every reason in one `Refused`. `depths` = `placesOfStored(body)` (changed in Part 2b: graph depth always). "Nothing changed." compares stored bodies with `canonicalJson`. Carry and remap as today (identity ids). Drafts take either model.
4. **Diff, blame, undo, YAML, mirror**: one entry point each over stored bodies.
   - Diff: both graph: `diffShapes` as today. Else `diffMetro(metroView(a), metroView(b))`. Return a tagged value (`{model: "graph", diff}` or `{model: "metro", diff}`) where the CLI and console need both. The portal web's routes keep answering in graph terms (`runOf` on both sides) so the web Map works unchanged until area D.
   - Blame: `node` and `edge` read `runOf` of each version; `line`, `station`, `track`, `group`, `frame` read `metroView` of each version.
   - Undo: a `node:` or `edge:` key needs a graph newest (else refused: "The shape is on the metro model now. Undo by station or track."); a metro key runs `undoMetroChange` on `metroView` of the three bodies and saves a metro body.
   - `exportShape(stored)` and `parseShape` read and write both (`model: metro` at the top picks the metro reader). The mirror writes whichever model the version holds.
5. **Numbers**: for a metro newest, the numbers answer per station (= per node id), per track (plain and back tracks = per edge id; a hub track = the sum of its entries' source edges) and per line (out line = its source's numbers; offer line = its offer's). Add the kinds `station`, `track`, `line` to `NumberKind`. Graph newest: unchanged.
6. **Records**: the shape detail keeps `body` (now `runOf(top.body)`) and `depths`, and adds `metro` (`metroView`) and `places`.
7. **CLI** (`apps/cli/src/shape.ts`): `wren shape convert [--version <n>] [--out <file>] [--write] [--note <text>]`. Without `--write` it writes nothing. It prints: the metro YAML (or writes it to `--out`), the `notes`, `checkMetro` errors, whether `graphOf` gives back the same graph and the same workflow, and the deal rule report: per offer line, its first station after the hub and its deal station, and how many open journeys sit on stations between them (these open a deal early under the artifact's rule, see Decisions). `--write` saves the metro body as the next version (note: `Convert to the metro model`, or `--note`). `shape show` prints lines, stations and tracks for a metro body. `add-node`, `connect` and `remove` refuse on a metro body: "Export, edit the YAML, import." `blame` and `undo` take the new keys.
8. **Tests**: integration in `packages/pipeline/test/integration` for save, carry, diff, blame and undo across a graph version then a metro version (run only the files you touched). CLI unit test for convert without `--write` on a synthetic database or the unit seam the CLI uses today.
9. **Map card** `map/objects/platform/shape.md`: the metro model, `runOf` and `metroView`, the convert command, the HELD part. Run `map/_meta/build.sh`, then `--check`.

---

## Part 2b: SQL readers, convert report, model guards

Planner review of Part 2 (10-21). Build this before Part 3.

1. **`run` column**: migration (next free number, additive, `drizzle-kit generate`): `shape_versions.run jsonb`, backfilled with `body` where `body ->> 'model'` is null, then not null. `saveShape` writes `run = runOf(body)` and `depths = depthOf(runOf(body))` for both models. `depths` is graph depth always: revert `placesOfStored` in the store, and drop the `isMetro ? runDepthsOf : depths` branches (`journeys.ts`, `records.ts`); the column is right now. Places: `placesOf(metroView(body))` on read (records `places`, CLI `show`).
2. **SQL readers read `run`**: the views `edge_flow`, `source_numbers`, `stage_flow` (`views.ts`) and `journeyShape` (`packages/core/src/segments.ts`). The migration drops and makes the views again, as `0306_shape.sql` did. `./scripts/gates.sh schema` must pass. Fix the `numbers.ts` header line "a version stored as a metro body has no crossings yet".
3. **Model guards in `saveShape`**: a graph body over a metro newest is refused: "The shape is on the metro model. Import a metro file (wren shape export, edit, import)." This covers the web save, draft apply and import in one place. In `undoStoredChange`: a metro key on a graph newest is refused: "The shape is on the graph model. Undo by node or edge."
4. **Convert in the pipeline**: `convertShape(db, {note, by, triggers})` in a pipeline module saves the newest graph as metro, the CLI `--write` calls it. Before it saves, it must prove: `checkStored` passes, `canonicalJson(graphOf(metro))` equals the newest graph, and `shapeWorkflow` of both is equal. Any miss refuses, with the reason.
5. **Convert report** (printed with and without `--write`): the notes; the checks (ok or each reason); graph equal yes/no; workflow equal yes/no; the deal rule: for each offer line, its first station and its deal station, and when they differ, the open journeys on stations between them (the people the artifact rule would open a deal for earlier).
6. **Line numbers per currency**: an offer line row follows what the graph offer rows do with currency. If those give one row per currency, do the same; else refuse to sum two currencies (null money, `currency` null) and say so in the comment.
7. **Tests**: integration `convertShape` end to end on the test database: seed a graph with events, convert, then `edge_flow`, `source_numbers`, `journeyShape` and `numberRows` give the same numbers as before the convert. Unit: each guard, the report lines.
8. Map card: update the HELD block (the SQL readers are done; only the guard stays HELD). Rebuild the map.

---

## Part 3: attach and flows

1. `Attach = {kind: AttachKind; ref: string; label?: string}`; `attach?: Attach[]` on lines, groups and stations. `ref` is an id or an `https://` URL, 1 to 500 characters, no spaces; `label` 80 characters at most. No content is copied. `checkMetro` checks kind, ref and label only.
2. `MetroFlow = {id; label; stations: MetroStation[]; tracks: MetroTrack[]}`; `flows?: MetroFlow[]` on `MetroBody`. Ids: flow ids unique; a flow's station and track ids unique inside the flow. A flow holds no hub. `checkMetro` runs the station, track, logic and cycle rules inside each flow, and a `link` station's `flow` must name a flow of the body. A flow does not link to itself, and links have no cycle.
3. Diff: `flow:<id>:<how>` (`renamed` = label; `changed` = any station or track inside). Blame and undo take `on: "flow"`. Attach changes are `changed` on the line, group or station. YAML writes `flows` after `frames` and reads it back. `lowerable` refuses link stations (already) and ignores `flows` and `attach` (they lower to nothing).
4. Tests: each rule, diff, blame and undo on flows and attach, YAML round trip with both.

---

## Part 4: HELD (commit, never push)

Message subject starts `HELD:`. One commit.

1. Migration `0315_metro_only.sql` (0314 is `shape_run`; take the next free number at the time): an insert trigger on `shape_versions` and `shape_drafts` that refuses a body without `model = 'metro'`. No rename: `depths` stays graph depth (Part 2b).
2. `saveShape` and `parseShape` refuse a graph body: "Convert first: wren shape convert."
3. Run `./scripts/gates.sh schema`.

---

## Checks and commits (every part)

- While building: `cd packages/pipeline && lockf -s /tmp/wren_automation-checks.lock pnpm -s vitest run <files>`, and `./scripts/gates.sh changed`. Never tsc, turbo or vitest for the whole repo.
- Biome format each file. Strings with inner double quotes use single quotes.
- Concise plain English in comments (ASD-STE100), no em dashes. Synthetic test data only: no client names, no amounts.
- Never touch prod. Never run `wren shape convert` against prod.
- `git add` new files, then `git commit -- <paths>`. Message ends with:

```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PpzL4T1jZXndKhYDqy2SGC
```

- Report: shas, what you built, anything you judged differently and why. Leave no process running.
