---
name: shape
description: Read the business shape (the Map: lines, stations, tracks, groups) and write changes to a draft with the `shape` CLI. Use when the person asks what the Map holds, why a part is there, what changed, or asks for a change: "add a station", "rename this line", "move this to", "connect these", "remove that", "draft this", "propose it".
---

# shape

You write to a draft. A person applies it on the Map. `shape` refuses every command that changes the live shape.

Wren's own shape: `shape <command>`. A client's: `shape --client <id> <command>`. The `[Page: …]` line names the client when the person has one open.

## Read

```sh
shape show [--version <n>]        # the outline, with open journeys per station
shape export [--version <n>]      # the whole body as YAML: every field of every item
shape versions | tags
shape diff <a> <b>                # what changed between two versions
shape blame <id> [--on line|station|track|group]   # every version that touched it, with who and why
shape view list | view show <id>  # the saved views
shape draft list                  # open drafts
shape draft show <draft>          # what apply would do: changes, a moved base, conflicts
```

## Change

1. Read `shape export`. Ids and field names come from it; never guess one.
2. One draft per request. Use the draft the page line names when it names one. Else: `shape draft new --name "<short name>" --note "<why>"`. It forks the newest version and prints the draft id.
3. `shape edit <draft> '<op>'`, or `shape edit <draft> --ops ops.json` for a list. A list is all or nothing. A refusal names the op and the fault: fix it and send the list again.
4. `shape draft show <draft>`. Fix each warning you caused. A conflict means live moved: say so.
5. Give the person the link `/?draft=<draft>` (a client: `/?draft=<draft>&client=<id>`). The Map draws the draft over the live shape. Say in two or three lines what changed and why.
6. `shape draft propose <draft>` only when the person says it is ready. It puts the draft on Today for a decision.

## Ops

```json
{"op":"add","on":"line|station|track|group","item":{…}}
{"op":"rename","on":"line|station|group","id":"…","label":"…"}
{"op":"rename","on":"shape","name":"…"}
{"op":"move","on":"station","id":"…","line":"…","group":"…"}
{"op":"move","on":"track","id":"…","from":"…","to":"…"}
{"op":"move","on":"group","id":"…","line":"…"}
{"op":"move","on":"line","id":"…","before":"<line id>"}
{"op":"remove","on":"line|station|track|group","id":"…"}
{"op":"set","on":"line|station|track|group","id":"…","field":"…","value":…}
{"op":"attach","on":"line|station|group","id":"…","ref":{…}}
{"op":"detach","on":"line|station|group","id":"…","ref":"…"}
```

- `add`: `item` is the whole item with a new id. Copy the fields of a sibling of the same kind from `shape export`. A new station needs a track to reach it: add both in one list.
- `move` station: `"group": null` takes it out of its group. `move` line: `"before": null` puts it last.
- `set`: one field. `"value": null` clears it.
- Frames and flows have no op. Say so; a person edits the file.

## Rules

- Never claim a change is live. It is live when a person applies the draft.
- Each draft carries a note that says why. Each op list tests one request.
- A selected station, track or line in the page line is what "this" means.
- When a request has two readings, ask one question first.
