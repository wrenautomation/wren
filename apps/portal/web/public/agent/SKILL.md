---
name: wren
description: Read and act on the user's Wren workspace (leads, contacts, deals, texts, emails, posts, pay links, documents, reports, any record type it has) through the `wren` CLI, as the user. Use when the user asks about their Wren data ("how many leads replied", "show the open deals", "what's waiting to approve", "find the thread with Sam") or, for Wren's team, to run a handler.
---

# wren

The CLI is `wren.mjs` in this skill's folder. Run it with Node 18+:

```sh
node ~/.claude/skills/wren/wren.mjs <command>
```

Below, `wren` is short for that. It prints JSON. A refusal prints `wren: <why>` on stderr and exits non-zero; tell the user the why.
Exit 3 means no token or a bad one: ask the user to run `node ~/.claude/skills/wren/wren.mjs login`
themselves with a token from Wren's Account > AI tools. Never ask them to paste a token to you.

## Read

```sh
wren types                                   # record types: id, name, fields, views. Start here.
wren list <type> --limit 20                  # rows; the answer has `next` for the page after
wren list <type> --cursor <next>             # the page after
wren list <type> --view <view-id>            # a saved view from `types`
wren list <type> --q "sam rivera"            # search
wren list <type> --where status=waiting --where channel=sms
wren list <type> --sort -createdAt
wren get <type> <id>                         # one row, its detail and activity
```

- Take type ids, field names and view ids from `types`. Don't guess them.
- Page with `--cursor` instead of raising `--limit` past 50.
- Answer from the rows. Say how many you read when a list was cut off.

## Act (Wren's team only)

```sh
wren handlers [words]                        # what can run
wren describe Service/handler                # its input schema
wren call Service/handler --key <key> --input '{"field":1}'
wren call Service/handler --input @in.json --confirm handler
```

- A handler with an effect (it sends, spends, posts or changes data) runs only with
  `--confirm <handler>`. Ask the user before every such call, and say what it will do.
- A client login can read but not call handlers. To approve something, the user clicks it in Wren.
- A token can be capped below its person: read only, or some apps. A refusal that names the token
  means that cap; the user makes a wider token in Account > AI tools if they want one.

## Shape (the map of the business)

One shape per workspace: sources, steps, offers and plans joined by flow edges (down toward money)
and loop edges (back up). A person sits on one node. Every change is a numbered version.

```sh
wren list pipeline.shape                     # the newest version: name, nodes, edges, open journeys
wren get pipeline.shape shape                # its body with each node's depth, and every version
wren list pipeline.journey --where status=open --where node=<node-id>
wren list pipeline.journey --view ghost      # people on a node the newest version removed
wren list pipeline.entry                     # one row per source node: open and all journeys
wren list pipeline.number --view edge        # views node, edge, offer: counts per node, edge or offer
wren call PipelineConsole/shapeDiff --input '{"a":1,"b":2}'
wren call PipelineConsole/shapeVersion --input @version.json --confirm shapeVersion
wren call PipelineConsole/shapeImport --input '{"text":"<yaml>"}' --confirm shapeImport
wren call PipelineConsole/shapePreview --input '{"text":"<yaml>"}'   # what a file would change; saves nothing
wren call PipelineConsole/shapeExport --input '{"ref":2}'             # a version or draft:<id> as YAML text; no ref: the newest
wren call PipelineConsole/shapeStart --confirm shapeStart             # the starter shape, only when none exists
wren call PipelineConsole/shapeDiff --input '{"a":2,"b":"draft:add-a-call"}'   # a version against a draft
wren list pipeline.shape_draft               # drafts: open ones first; --view proposed|all
wren get pipeline.shape_draft <id>           # one draft: body and moves
wren call PipelineConsole/shapeDraftNew --input @draft.json --confirm shapeDraftNew
wren call PipelineConsole/shapeDraftUpdate --input @draft.json --confirm shapeDraftUpdate
wren call PipelineConsole/shapeDraftPropose --input '{"id":"add-a-call"}' --confirm shapeDraftPropose
wren call PipelineConsole/shapeBlame --input '{"station":"<id>"}'     # or node, edge, track, line, group
wren call PipelineConsole/shapeUndoPreview --input '{"a":1,"b":2,"change":"node:call:added"}'
wren call PipelineConsole/shapeUndo --input '{"a":1,"b":2,"change":"node:call:added"}' --confirm shapeUndo
wren call PipelineConsole/shapeTag --input '{"name":"before-pricing","version":3}' --confirm shapeTag
```

- `shapeVersion` takes `{ body, note, moves? }`, or `{ from, note }` to save a copy of version
  `from` as the next one (a restore). Send exactly one of `body` and `from`. Every body is a metro body: a graph body is refused ("Convert first: wren shape convert."). A restore of an old graph version saves its drawn form. `moves` is `{ "<old node>": "<new node>" }` for
  people on a node the new body drops. `shapeImport` takes the YAML file text (a metro file: `model: metro`, `name`,
  `lines`, `stations`, `tracks`, optional `note`, `moves`, `terms`). Both refuse with every reason, or with
  "Nothing changed." when the body equals the newest.
- `shapePreview` reads a file against the newest version: `{ a, diff, changes, views, marks, note, moves }`.
  `changes` is `[{ key, line }]`; `views` and `marks` are the map's drawing of both sides (null when
  a side cannot be drawn).
  `shapeStart` saves the kind-only starter (note "Starter") and refuses when a shape exists.
- Say why in `note`. A version is never edited or deleted.
- **An agent proposes; a person applies in the Map.** To change the shape, edit a draft with ops.
  Five steps:
  1. `wren call PipelineConsole/shapeDraftNew --input '{"name":"…","note":"…"}' --confirm shapeDraftNew`.
     Send no body. The draft forks the live shape.
  2. `wren call PipelineConsole/shapeDraftEdit --input @ops.json --confirm shapeDraftEdit`. The
     input is `{ "id": "<draft id>", "ops": [ … ] }` (one op may stand alone). All ops apply, or none.
     Read the ids first: `wren get pipeline.shape shape`. The answer is `{ id, lines, warnings }`.
     Op kinds, one example each:
     - add: `{"op":"add","on":"station","item":{"id":"call","label":"Call","kind":"time","line":"signed","column":"sales","action":"book"}}` (`on`: line, station, track or group)
     - rename: `{"op":"rename","on":"station","id":"call","label":"Book a call"}` (the shape: `{"op":"rename","on":"shape","name":"…"}`)
     - move: `{"op":"move","on":"station","id":"call","column":"delivery"}` (also a track's ends, a group's line, a line's place)
     - remove: `{"op":"remove","on":"track","id":"engaged_to_call"}`
     - set: `{"op":"set","on":"station","id":"call","field":"idleDays","value":5}` (`null` removes the field)
     - attach: `{"op":"attach","on":"station","id":"call","ref":{"kind":"sop","ref":"call-script"}}`
     - detach: `{"op":"detach","on":"station","id":"call","ref":"call-script"}`
  3. Read `warnings`. Each one is a reason apply will refuse. Fix them with more ops.
  4. `wren call PipelineConsole/shapeDraftPlan --input '{"id":"…"}'`. Show the user `lines` (what
     apply changes) and `conflicts` (live moved on a field the draft also changed).
  5. `shapeDraftPropose` `{ id }`. Never call `shapeDraftApply` or `shapeDraftDrop` unless the user
     asked you to. The user applies or drops it in the Map.
  `shapeDraftNew` may still take a whole `body` (`{ name, body, moves?, base?, note? }`), and
  `shapeDraftUpdate` `{ id, body, moves?, note? }` replaces one. Compare with `shapeDiff` (`b` can
  be `draft:<id>`). A draft is not checked until it is applied.
- **From a drawing.** Read the board on draw.wrenautomation.com with the excalidraw skill (the
  `draw` CLI). Map each box to a station and each arrow to a track. Reuse the ids that exist; ask
  the user when a box or an arrow is unclear. Write the ops into a draft, then do step 4. Never
  edit the live shape.
- `shapeBlame` takes exactly one of `node`, `edge`, `station`, `track`, `line` or `group`. It answers `{ lines }`: each version that
  added, removed, renamed or changed it, newest first, with who, when and why (`note`).
- To undo one change, read `shapeDiff` (`{ a, b, diff, changes, views, marks }`), pick the `key`
  of a line in `changes` (on a metro shape the keys are station, track and line keys, even for two graph versions; `node:<id>:added`, `edge:<id>:changed`, `station:<id>:added`, `name`), and call `shapeUndoPreview` `{ a, b, change }` first. It saves
  nothing. It answers the line, the note, the version it applies to, and the diff with its `changes`, or refuses with
  every reason (open people on a node the undo would remove, a change that is already gone). Show
  the user, then call `shapeUndo`. It saves the next version with the note `Undo: <line>`.
- `shapeTag` `{ name, version, note? }` names one version. A tag never moves or goes away.
  `wren get pipeline.shape shape` lists each version with its tags and the link to its commit in
  the private repo.
- A person moves along an edge that exists. A move to any other node needs a reason.
  Remove a node only after you move its people.
- On the repo's own CLI the same work is `wren shape show|versions|diff|export|import|add-node|connect|remove|move|edit|draft|blame|undo|tag|tags|mirror`.
  `wren shape edit <draft> '<op json>'` (or `--ops <file>`) is step 2; `wren shape draft show <id>` is step 4.
  `wren journeys` and `wren numbers --window 7|30|90|all` read people and counts.

`--pretty` indents the JSON. `--host https://...` points at another Wren (a client's own address).
