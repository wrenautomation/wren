---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-19 @ 7c5353bc
entity: packages/core/src/vault-keys.ts:1
---

# vault key (the operator's API keys, mirrored; keys as Accounts rows)

The operator's API keys live in autobrowse's vault. Wren keeps a no-secret mirror, `vault_keys`, so Marketing → Accounts lists them beside logins and each client's own keys without a call on page load.

## Why this shape

The Accounts page makes no vendor call on load, so the vault's list is copied hourly and after each action. The source has no secret; a row that carries a `secret` is dropped and logged by address. The shapes (`KeyRow`, the `keys`, `keySpend`, `keyRevoke`, `keyRotate` answers) are copied by hand from autobrowse `src/sites/keys.ts`: wren imports nothing from it. A loop object, not a new column on an existing scheduler: the three actions need a service anyway, and an exclusive object serialises them with the hourly pass.

## Shape

- `vault_keys` (`packages/core/src/keys-schema.ts:126`): `address` pk (`site@account`), site, account, owner, `key_id` (12 hex), `purposes text[]`, status `live|spent|revoked`, `spent_until`, made_at, revoked_at, via, vendor_id, uses, last_used_at, `read_at`. Exempt from the audit log (`packages/db/src/audit/index.ts`): rewritten hourly, the vault is the log
- `client_secrets.key_id`: set by stage, rotate, bind and put, so a client key's spend joins on `vendor_usage.key_id`; rows older than the column have null (their spend shows only when the client holds one live key of the vendor)
- `syncVaultKeys` (`packages/core/src/vault-keys.ts:110`): upsert every row, delete addresses no longer listed, stamp `read_at`; a row with `secret` or a bad shape is refused (counted, logged)
- `VaultKeys/box` (`:204`, loop object, hourly `sync`; start it once after deploy: `docs/restate-operations.md`): `rotate` (`desk/keyRotate`, no sync; the run's own gate asks in To approve), `revoke` (`sites/keyRevoke`) and `spend` (`sites/keySpend`), the last two then mirror again. A key not in the mirror is refused 404 before autobrowse hears of it. Registered in `apps/worker/src/services.ts`
- `keyAccounts` (`:371`): both kinds as one list. Operator keys from the mirror (a spent key past its date reads live). Client keys: live `client_secrets` whose name is a vendor's key name (`vendorOfKeyName`: `EXA_API_KEY` is `exa`); purposes from the client's own `vendor_modes` rows whose `key_name` is the ref; spend this month by `usageByKey` on `key_id`; last used is the last `read` event
- Rows: `keyRow` (`packages/outreach/src/records.ts:974`) joins `marketing.account` with `platform: "api"` (view "API keys"), columns owner, purposes, out of credit until, spend (USD), last used. Row actions on operator keys only: `ACCOUNT_ACTIONS` (`apps/portal/web/src/modules/marketing/social.ts:12`), run through `console/call` to `VaultKeys/box`
- CLI: `wren accounts keys [--vendor] [--client]`, `wren accounts key rotate|revoke|spend <address>` (`apps/cli/src/accounts.ts`)

## Connected to

- **owns:** `vault_keys`, `VaultKeys`
- **owned-by:** autobrowse `sites` / `desk` `keys` handlers (the vault is the source); credvault `KeyInfo`
- **joins:** [[platform/vendors]] (`usageByKey`, `client_secrets.label`, `vendor_modes.purpose`); [[platform/loop-object]]; [[platform/records]] (the Accounts record)
- **looks-like-but-is-not:** `client_secrets` (sealed client keys, with values), autobrowse's own login accounts (`reach_accounts`)

## If you change this

- **Hits:** autobrowse `src/sites/keys.ts` (the copied shapes), Accounts page rows and actions, `console/call` permission (`run` over Wren: operator only)
- **Does not hit:** how a call picks a key (`vendorKey`); a client's key is rotated in Account → Vendors; client portals have no Accounts page

## Surfaces

| Surface | Role |
|---|---|
| Marketing → Accounts (Wren's team) | reads rows; rotate, revoke, mark spent on operator keys |
| `wren accounts keys`, `key rotate/revoke/spend` | the same functions |
| Hourly `VaultKeys/box` | writes the mirror |

## See

- Source: `packages/core/src/vault-keys.ts`
- Design: `../autobrowse/designs/2026-10-19-api-keys-as-accounts.md`, brief `designs/briefs/2026-10-19-api-keys-w2-accounts-rows.md`
