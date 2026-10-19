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
```

- `shapeVersion` takes `{ body, note, moves? }`. `moves` is `{ "<old node>": "<new node>" }` for
  people on a node the new body drops. `shapeImport` takes the YAML file text (`name`, `nodes`,
  `edges`, optional `note`, `moves`, `terms`). Both refuse with every reason, or with
  "Nothing changed." when the body equals the newest.
- Say why in `note`. A version is never edited or deleted.
- A person moves along an edge that exists. A move to any other node needs a reason.
  Remove a node only after you move its people.
- On the repo's own CLI the same work is `wren shape show|versions|diff|export|import|add-node|connect|remove|move`.
  `wren journeys` and `wren numbers --window 7|30|90|all` read people and counts.

`--pretty` indents the JSON. `--host https://...` points at another Wren (a client's own address).
