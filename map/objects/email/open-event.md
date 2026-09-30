---
type: object
cluster: email
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-email/src/schema.ts:369
---

# open-event

One pixel fetch attributed to a message. Tables `open_events` and its cursor `open_syncs`. Bound only when a pixel host is configured; shipped dark until then.

## Why this shape

The remote host is the source of truth, read forward from an explicit cursor so unattached hits never re-fetch forever (`inbox/opens.ts:1`). An open decides nothing: no switch, stop or suppression reads these rows. Machine-vs-person is judged at read time in `open_outcomes` (`views.ts:62`).

## Shape

- `open_events`: `message_id`, `remote_id`, `seen_at`, `user_agent`, `run_id` (`schema.ts:370`–`376`)
- `open_syncs`: `base_url`, `cursor_id`, `synced_at`, `stats` (`:400`–`403`)
- `messages.open_token` is minted at compose (`schema.ts:260`)

Citations: `packages/channel-email/src/schema.ts:369`, `packages/channel-email/src/inbox/opens.ts:100`

## Connected to

- **owned-by:** [[email/message]]
- **joins:** `deploy/pixel` (the Cloudflare Worker that serves the pixel and the export)

## If you change this

- **Hits:** `inbox/opens.ts`, `restate/opens-scheduler.ts`, `open_outcomes`, the pixel Worker's export shape
- **Does not hit:** anything that sends or stops

## Surfaces

| Surface | Role |
|---|---|
| `OpensScheduler` (when `WREN_OPEN_TRACKING` and `WREN_PIXEL_*` set) | writes |
| `open_outcomes` | reads |

## See

- Source: `packages/channel-email/src/inbox/opens.ts`
