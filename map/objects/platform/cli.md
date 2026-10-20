---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-19 @ 05e9f4a4
entity: apps/cli/src/main.ts:118
---

# cli

`wren`: the operator's hands. `bin/wren` is an esbuild bundle that rebuilds itself when source changes; never run with tsx.

## Why this shape

Reads go straight to Postgres; writes that are one-row operator facts (approve, pause, suppress, import) go to Postgres with their own ledger row; anything that sends, spends or must not run twice goes through a Restate service by name (`apps/cli/src/email.ts:1`, `content.ts:1`, `sms.ts:1`, `ads.ts:1`). So the CLI can never send by itself.

## Shape

- `main.ts:37`–`90`: `status` (reads content, `packages/content/src/status.ts`), `db check`, `tokens`, `report weekly`; `email.ts`, `review.ts` (drafts, approve, reject, edit, stop, preview, reply, event), `content.ts`, `ads.ts`, `sms.ts`, `fetch.ts`, `books.ts` (`wren books`, registered at `main.ts:106`), `pipeline.ts` (`wren offers`, `terms`: the version store; `terms` takes `--client`, `offers` is main only; `journeys`, `deals`, `numbers`: moves, deals and the numbers views, all take `--client`, with writes sent to the `Journeys` service), `shape.ts` (`wren shape show|versions|diff|export|import|start|add-node|connect|remove|move|draft|blame|undo|tag|tags|mirror`: the shape's version store, edits and history, takes `--client`; `shape move` is the same handler as `journeys move`; `shape start` saves the starter shape as version 1 when no shape exists; every save mirrors to the private repo and prints one line; `shape mirror --all` opens Wren's database and each client's; `main.ts` builds the mirror from `WREN_SHAPES_GITHUB_TOKEN` and `WREN_SHAPES_GITHUB_REPO`, see [[platform/shape]])
- `walkthrough/demos/prod.sh` points one command at prod, read-only
- `~/.local/bin/wren` links to `bin/wren` (outside the repo)

Citations: `apps/cli/src/main.ts:118`

## Connected to

- **joins:** [[platform/settings]], [[platform/restate-services]] (ingress URL + token), every table it reads

## If you change this

- **Hits:** `README.md`, `walkthrough/*.md`, `docs/restate-operations.md` (commands quoted), `scripts/gates.sh` (`cli` check)
- **Does not hit:** the worker

## Surfaces

| Surface | Role |
|---|---|
| William | runs |

## See

- Source: `apps/cli/src/main.ts`
