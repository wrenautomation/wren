---
name: folders
description: File chats, Vireo subjects and Weaver runs into the one folder tree William sees in the portal. Use when he says "put this in <folder>", "make a folder for <topic>", "move it to", "organize my chats", or when a new chat, run or subject clearly belongs in a folder that exists.
---

# folders

One folder tree for all work. William sees it beside every list in the portal: chats, Variants subjects, Research runs. Design: `wren/designs/2026-11-08-folders.md`.

```sh
folders tree [--kind chat|subject|run]        # every folder with its path, and what is filed where
folders new "<name>" [--in <folder>]           # nests at most 3 deep
folders rename <folder> "<name>"
folders move <folder> --to <folder|top>
folders drop <folder>                          # what it holds goes up one level; at the top, unfiled
folders file <kind> <ref>... --to <folder>     # or --out to unfile
```

A `<folder>` is its id or its path: `Plumbers/Openers`. JSON out; a no is `{"error": "…"}`.

## Refs

- `chat`: a chat's session id. Your own is in the `[Chat: …]` line of each turn.
- `subject`: the Vireo subject's id (`vireo show <slug>` gives it).
- `run`: the Weaver run id (`weaver runs`).

## Rules

- Run `folders tree` before you file. Use a folder that exists; make one only when he asks or none fits, and say its name.
- One item, one folder. Filing it again moves it.
- Never drop or rename a folder he did not name.
