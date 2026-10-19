# Brief W1: several keys per client per vendor, resolver by purpose, key id on vendor_usage

Bead wa-sos.3 (part 1 of 2). Design: `../autobrowse/designs/2026-10-19-api-keys-as-accounts.md`, section "wren" (read "Target" first). Existing designs: `designs/2026-10-07-vendor-keys.md`, `designs/2026-10-07-key-store.md`. Cards: open `map/routing.md`, then the cards for `client_secrets`, `vendor_modes` and `vendor_usage` (clients/ and platform/ clusters), one at a time.

wren imports nothing from autobrowse or credvault. Where it needs their rules (the key id), it copies them, with a test vector.

## Build

### 1. Schema (one migration; take the next free number when you commit, another planner adds migrations too)

- `client_secrets`: `label varchar(64) not null default 'default'` (rule `/^[a-z0-9][a-z0-9.-]{0,63}$/`). The live unique index becomes `(client, name, label) where state = 'live'`. A label is the account part of an address: a client's Exa key `exa@default`, a second one `exa@bulk-2`.
  - Why `name` and not `vendor`: one vendor has two names (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`); the name already says the vendor.
- `vendor_modes`: `purpose varchar(32) not null default 'default'` (`ROLE_NAME`-style word). The unique becomes `(client, vendor, purpose)`, nulls not distinct. Each row's `key_name` (the `ks_` ref) picks one key, so a client on its own keys holds one row per purpose it uses.
- `vendor_usage`: `key_id varchar(12)` null, and an index `(key_id, at)`. A row whose key wren does not hold (a path holds it: autobrowse's Exa ring, the gateway) keeps null.
- Existing rows: every secret gets `default`, every mode row `default`. Nothing else moves.
- Drizzle schema files, the snapshot, and the schema test (`wren-pre-ready-checks`: db schema test).

### 2. The key store (`packages/core/src/keys.ts`)

- `stage`, `bind`, `put` take `label?` (default `default`). `bind`/`put` of a name and label that is live makes its next version under the same ref, as today per name. `liveByName` keys on (client, name, label). `named` takes `label?` too.
- `KeyInfo` gains `label`. `apps/cli/src/keys.ts`: `--label` on `put`, the label in `list`.
- `keyProblem` rejects a bad label with the rule, never the value.

### 3. The resolver by purpose (`packages/core/src/vendor-keys.ts`)

- `vendorKey(db, client, vendor, o)` and `VendorKeys.key/use` take `purpose?` (default `default`). The client's row for that purpose, else its `default` row. Own mode: that row's key only; none saved → `VendorKeyMissing`, never Wren's (today's rule, unchanged). Managed: Wren's.
- The cache key in `vendorKeys` includes the purpose.
- `VendorKey` gains `id: string | null`: `keyId(key)` when wren holds the value, else null.
- `keyId(secret)` in `packages/core/src/key-id.ts`: sha256 hex, first 12 characters, of the trimmed value; the same as credvault `keyId` and autobrowse's ring fingerprint. Test with a fixed synthetic vector (`keyId("sk-test-0000") === <its hash>`; compute it in the test file once and pin it).

### 4. Usage per key

- `meter(...)` (`packages/core/src/vendors.ts`) takes `keyId?: string | null` and writes it. `VendorKeys.use` passes `k.id`.
- `usageByKey(db, { since })` → `Map<keyId, { micros, units, calls }>`: what the Accounts page (W2) shows as spend this month.

### 5. Setting a purpose

The CLI that sets a client's mode (find it: `grep -rn vendorModes apps/cli/src packages/*/src`) takes `--purpose <word>` (default `default`) and `--key <ks_ref>` per purpose. The portal's Account → Vendors page is unchanged (the design keeps per-call key choice in the portal out of scope); it shows and edits the `default` row only.

## Tests

Integration (only the packages you touched: `packages/core`, `packages/db`, and the package that owns the mode CLI): two live keys of one name with two labels; bind a second version under one label; resolver picks the purpose row, falls back to `default`, refuses own with no key (never managed); `meter` writes `key_id`; `usageByKey` sums one month. Unit: `keyId` vector; label rule. Synthetic keys only.

## Rules

- Worktree: `git -C /Users/williamjin/Documents/wren_automation/wren worktree add ~/worktrees/wren-keys -b wa-sos-3-keys main`, `pnpm install`.
- While building: `./scripts/gates.sh changed`, or `pnpm exec vitest run <file>` for one file. Integration only for the packages you touched. The planner runs the full `./scripts/gates.sh` at hand-off.
- Never touch `apps/cli/src/learn.ts`, `packages/learn/src/score.ts`, `packages/learn/test/integration/*`.
- Never print a key value, read or source an env file, or run a command whose text contains ".env". The repo is public: no client names, amounts or lead data; tests synthetic.
- Update the cards you read (`verified` date and commit) and `map/_meta/build.sh`.
- Commit only your paths: `git commit -q -F <msgfile> -- <paths>`, with the planner's trailers. No push.
