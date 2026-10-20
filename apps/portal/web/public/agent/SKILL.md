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
wren call PipelineConsole/shapeExport --input @body.json              # a body as YAML text
wren call PipelineConsole/shapeStart --confirm shapeStart             # the starter shape, only when none exists
wren call PipelineConsole/shapeDiff --input '{"a":2,"b":"draft:add-a-call"}'   # a version against a draft
wren list pipeline.shape_draft               # drafts: open ones first; --view proposed|all
wren get pipeline.shape_draft <id>           # one draft: body and moves
wren call PipelineConsole/shapeDraftNew --input @draft.json --confirm shapeDraftNew
wren call PipelineConsole/shapeDraftUpdate --input @draft.json --confirm shapeDraftUpdate
wren call PipelineConsole/shapeDraftPropose --input '{"id":"add-a-call"}' --confirm shapeDraftPropose
wren call PipelineConsole/shapeBlame --input '{"node":"<node-id>"}'   # or {"edge":"<edge-id>"}
wren call PipelineConsole/shapeUndoPreview --input '{"a":1,"b":2,"change":"node:call:added"}'
wren call PipelineConsole/shapeUndo --input '{"a":1,"b":2,"change":"node:call:added"}' --confirm shapeUndo
wren call PipelineConsole/shapeTag --input '{"name":"before-pricing","version":3}' --confirm shapeTag
```

- `shapeVersion` takes `{ body, note, moves? }`. `moves` is `{ "<old node>": "<new node>" }` for
  people on a node the new body drops. `shapeImport` takes the YAML file text (`name`, `nodes`,
  `edges`, optional `note`, `moves`, `terms`). Both refuse with every reason, or with
  "Nothing changed." when the body equals the newest.
- `shapePreview` reads a file against the newest version: `{ a, diff, bodies, note, moves }`.
  `shapeStart` saves the kind-only starter (note "Starter") and refuses when a shape exists.
- Say why in `note`. A version is never edited or deleted.
- **An agent proposes; a person applies in the Map.** To change the shape, save a draft
  (`shapeDraftNew`: `{ name, body, moves?, base?, note? }`; the id comes from the name), compare it
  with `shapeDiff` (`b` can be `draft:<id>`), then `shapeDraftPropose` `{ id }`. Change a draft with
  `shapeDraftUpdate` `{ id, body, moves?, note? }`. A draft is not checked until it is applied.
  Do not call `shapeDraftApply` or `shapeDraftDrop` unless the user asked you to. The user applies
  or drops it in the Map.
- `shapeBlame` takes exactly one of `node` or `edge`. It answers `{ lines }`: each version that
  added, removed, renamed or changed it, newest first, with who, when and why (`note`).
- To undo one change, read `shapeDiff`, pick a line's `changeKey` (`node:<id>:added`,
  `edge:<id>:changed`, `name`), and call `shapeUndoPreview` `{ a, b, change }` first. It saves
  nothing. It answers the line, the note, the version it applies to and the diff, or refuses with
  every reason (open people on a node the undo would remove, a change that is already gone). Show
  the user, then call `shapeUndo`. It saves the next version with the note `Undo: <line>`.
- `shapeTag` `{ name, version, note? }` names one version. A tag never moves or goes away.
  `wren get pipeline.shape shape` lists each version with its tags and the link to its commit in
  the private repo.
- A person moves along an edge that exists. A move to any other node needs a reason.
  Remove a node only after you move its people.
- On the repo's own CLI the same work is `wren shape show|versions|diff|export|import|add-node|connect|remove|move|draft|blame|undo|tag|tags|mirror`.
  `wren journeys` and `wren numbers --window 7|30|90|all` read people and counts.

`--pretty` indents the JSON. `--host https://...` points at another Wren (a client's own address).
