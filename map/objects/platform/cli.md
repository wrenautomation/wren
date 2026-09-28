---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-09-28 @ 83459e9
entity: apps/cli/src/main.ts:37
---

# cli

`wren`: the operator's hands. `bin/wren` is an esbuild bundle that rebuilds itself when source changes; never run with tsx.

## Why this shape

Reads go straight to Postgres; writes that are one-row operator facts (approve, pause, suppress, import) go to Postgres with their own ledger row; anything that sends, spends or must not run twice goes through a Restate service by name (`apps/cli/src/email.ts:1`, `content.ts:1`, `sms.ts:1`, `ads.ts:1`). So the CLI can never send by itself.

## Shape

- `main.ts:37`–`90`: `status` (reads content, `packages/content/src/status.ts`), `db check`, `tokens`, `report weekly`; `email.ts`, `review.ts` (drafts, approve, reject, edit, stop, preview, reply, event), `content.ts`, `ads.ts`, `sms.ts`, `fetch.ts`
- `walkthrough/demos/prod.sh` points one command at prod, read-only
- `~/.local/bin/wren` links to `bin/wren` (outside the repo)

Citations: `apps/cli/src/main.ts:37`

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
