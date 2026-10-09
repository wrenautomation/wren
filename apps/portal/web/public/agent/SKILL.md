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

`--pretty` indents the JSON. `--host https://...` points at another Wren (a client's own address).
