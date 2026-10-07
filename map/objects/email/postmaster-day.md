---
type: object
cluster: email
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-email/src/schema.ts:442
---

# postmaster-day

Google Postmaster's numbers for one sending domain on one day, upserted daily. Table `postmaster_days`.

## Why this shape

The complaint rate is the one number that can end a domain and the only one we cannot see any other way; above ~0.3% Google turns (`SPAM_RATE_LIMIT`, `inbox/postmaster.ts:72`). It is stored and surfaced, never wired to a pause: the kill switches stay on hard bounces whose meaning we own (`postmaster.ts:1`). Empty days are normal below Google's volume threshold.

## Shape

- `domain`, `day`, `spam_rate`, `domain_reputation`, SPF/DKIM/DMARC ratios, `delivery_error_rate`, TLS counts, `raw`, `run_id` (`schema.ts:443`–`455`)

Citations: `packages/channel-email/src/schema.ts:442`, `packages/channel-email/src/inbox/postmaster.ts:364`

Per client (Inbox health installed): `PostmasterScheduler/<c>/daily` reads its `accounts.postmaster` domains into its own database, only those whose `domain` account holds `postmaster.verified` (`clientPostmaster`, `restate/postmaster-scheduler.ts`); the rest are `not_verified` on the pass. Wren's Postmaster login reads them.

## Connected to

- **joins:** [[email/roster]] domains; the digest (`restate/digest-scheduler.ts`)

## If you change this

- **Hits:** `syncPostmaster` (`postmaster.ts:364`), `PostmasterScheduler`, the digest's complaint line
- **Does not hit:** `sender_pauses`, the send tick

## Surfaces

| Surface | Role |
|---|---|
| `PostmasterScheduler` (when `WREN_POSTMASTER_USER` set) | writes |
| `PostmasterScheduler/<c>/daily` | writes the client's database |
| `DigestScheduler`, weekly report | read |

## See

- Source: `packages/channel-email/src/inbox/postmaster.ts`
