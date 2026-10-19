# Brief W2: API keys on the Accounts page

Bead wa-sos.3 (part 2 of 2). Design: `../autobrowse/designs/2026-10-19-api-keys-as-accounts.md`, section "wren", and `designs/2026-10-15-accounts-first-class.md`. Builds on W1 (`designs/briefs/2026-10-19-api-keys-w1-labels-purpose-usage.md`, its commit is on your branch). The autobrowse side: `../autobrowse/designs/briefs/2026-10-19-api-keys-b-mint-rotate-handlers.md` §3 and the `KeyRow` type in autobrowse `src/sites/keys.ts` on branch `wa-sos-2-keys` (`~/worktrees/autobrowse-keys`). Copy the shapes by hand: wren imports nothing from autobrowse.

## Build

### 1. The operator's keys, mirrored (no autobrowse call on page load)

- Table `vault_keys` (main, one migration, next free number): `address` (pk), `site`, `account`, `owner`, `key_id` (12), `purposes text[]`, `status`, `spent_until`, `made_at`, `revoked_at`, `via`, `vendor_id`, `uses int`, `last_used_at`, `read_at`. No secret, ever: the source has none.
- `syncVaultKeys(db, sites)`: calls autobrowse `sites/keys` `{ all: true }` through the existing Restate `SITES` client pattern (`packages/core/src/content/restate.ts`, `SITES`/`DESK`), upserts every row, deletes addresses no longer listed, stamps `read_at`. One handler on an existing hourly scheduler or a new `VaultKeys` service with an hourly `sync` (pick the smaller change; say which in the report). Also run after each action below.

### 2. Actions

- `rotate(address)` → `desk/keyRotate` (the Console needs the Mac's browser); answers the run id; the page says "Rotation started: approve it in To approve" (the run's own gate asks).
- `revoke(address)` → `sites/keyRevoke`; then `syncVaultKeys`.
- `spend(address, until?)` → `sites/keySpend`; then sync.
- Behind the operator's permission only (Wren's team, the RBAC permission that guards Accounts edits today). A client never sees the operator's keys.
- CLI: `wren accounts keys [--vendor v]` lists both kinds (below); `wren accounts key rotate|revoke|spend <address>` call the same functions.

### 3. Rows on Marketing → Accounts (`marketing.account`, `packages/outreach/src/records.ts`)

API keys sit beside logins as rows with `platform: "api"` (or the record's channel field set to the vendor; pick what the record's `channel` filter reads best, and keep `accountField` and the "account fields" guard in `apps/worker/src/components.test.ts` green):

| column | operator key (`vault_keys`) | client key (`client_secrets` live) |
|---|---|---|
| account | `site@account` | `<vendor>@<label>` (vendor from the name: `EXA_API_KEY` → `exa`) |
| owner | `wren` or the autobrowse owner | the client id |
| purposes | `purposes` | the `vendor_modes` purposes whose `key_name` is this ref |
| status | `status` (with "until <date>" when spent) | `live` |
| spend this month | `usageByKey` (W1) by `key_id`, in dollars | same (W1 writes `key_id` for own keys) |
| last used | `last_used_at` | the last `read` event in `client_secret_events` |

A client's portal shows only its own key rows (the record's tenancy rules as for its other rows). The operator sees every row. Rotate, revoke and mark spent are row actions on operator keys only; a client key is rotated where it is today (Account → Vendors).

Use the shared UI parts (`packages/ui/src/accounts.tsx`, the record's row actions, `callOnce` write path). No per-page copies. Story for the new row state in the Accounts story (render, play, axe; no screenshot baselines).

## Tests

Integration in `packages/outreach` (and wherever `syncVaultKeys` lands): sync from a fake `sites` client (upsert, delete gone, no secret field accepted: a row with `secret` is dropped and logged); rows for both kinds; a client sees only its own; spend sums by key id. The Restate client is faked; nothing calls a real autobrowse.

## Rules

- Same worktree as W1: `~/worktrees/wren-keys`, branch `wa-sos-3-keys`.
- While building: `./scripts/gates.sh changed`, or one test file. Integration only for the packages you touched. Story checks through `./scripts/gates.sh ui` if you add a story.
- Never touch `apps/cli/src/learn.ts`, `packages/learn/src/score.ts`, `packages/learn/test/integration/*`.
- Never print a key value, read or source an env file, or run a command whose text contains ".env". Public repo; synthetic data.
- Update the cards you read (Accounts record, the new table) and `map/_meta/build.sh`.
- Commit only your paths: `git commit -q -F <msgfile> -- <paths>`, with the planner's trailers. No push.
