---
type: object
cluster: email
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-email/src/schema.ts:410
---

# inbox-sync-cursor

Where each mailbox read left off. Table `inbox_syncs`, one row per sender. Not the loop handler `sync`.

## Why this shape

A per-sender cursor makes a re-run cheap and a one-day overlap harmless, because events are append-only by Gmail id (`inbox/sync.ts:1`). A failed pass leaves the cursor where it was and is asked again after one tick (`restate/inbox-scheduler.ts:1`).

## Shape

- `sender`, `cursor_ms`, `synced_at`, `stats` (`schema.ts:411`–`414`)

Citations: `packages/channel-email/src/schema.ts:410`

## Connected to

- **owned-by:** [[email/roster]] (keyed by sender)
- **produces:** [[email/thread-event]]

## If you change this

- **Hits:** `syncInbox` (`inbox/sync.ts:660`), `InboxScheduler/{sender}`
- **Does not hit:** `open_syncs` (a separate cursor for a separate host)

## Surfaces

| Surface | Role |
|---|---|
| `InboxScheduler/{sender}` | writes |

## See

- Source: `packages/channel-email/src/inbox/sync.ts`
