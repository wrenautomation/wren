---
type: object
cluster: email
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-email/src/send/roster.ts:301
---

# roster

Who may send, for which niches: `senders_config.toml`, loaded by `loadRoster` into `Sender[]`. Not in the database.

## Why this shape

A sender missing from the file cannot be sent through; every defect is a `RosterError`, never a skip (`roster.ts:1`). The module never imports the niche registry: the composition root passes the known names in (`apps/worker/src/services.ts`, `loadRoster(..., NICHES)`).

## Shape

- `loadRoster(path, knownNiches, mailboxes)` (`roster.ts:301`); `RosterError` (`:20`)
- per sender, optional: `transport` (`gmail` default, `smtp`), `ramp = { start, from, step, ceiling }` (its own warmup, else the fleet's), `dkim` (selector, for the digest's DNS check). An smtp sender with no mailboxes-file row is a `RosterError`; the root passes the file's addresses in
- prod copy lives in SSM `/wren/prod/senders_config`, pulled at Lambda cold start (`apps/worker/src/lambda.ts:18`; `deploy/terraform/lambda.tf:16`; `deploy/scripts/push-secrets.sh:42`)

Citations: `packages/channel-email/src/send/roster.ts:301`

## Connected to

- **owns:** the set of keys for `SendScheduler/{sender}` and `InboxScheduler/{sender}`
- **joins:** [[email/send-policy]] (caps are per inbox), [[email/sender-pause]] (keyed by sender), [[email/transport]] (which carrier)
- **looks-like-but-is-not:** [[sms/sms-number]] (the SMS fleet lives in a table)

## If you change this

- **Hits:** the file and the SSM parameter both; every send and inbox loop key; `enrollments.sender` chosen at compose
- **Does not hit:** templates; the Gmail service account (that is `WREN_GOOGLE_SERVICE_ACCOUNT` and `WREN_SEND_TRANSPORT`)

## Surfaces

| Surface | Role |
|---|---|
| William, `senders_config.toml`, then `push-secrets.sh` | writes |
| worker build (`services.ts`) | reads once per cold start |

## See

- Source: `packages/channel-email/src/send/roster.ts`
