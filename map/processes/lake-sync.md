---
type: process
status: verified
verified: 2026-10-13 @ 0cba6527
consumes: ["[[platform/db-schema]]"]
produces: []
---

# lake-sync

Every table of Wren's database and each client's, copied nightly into the lake with all history; then the warehouse's models.

## Input → Movement → Output

Postgres tables. `wren lake sync` diffs each by row hash and writes what changed as one DuckLake snapshot per table: Parquet in the lake bucket, the catalog in the `wren_lake` database. `wren lake build` runs `lake/models/*.sql` into `warehouse.*`. Models headed `-- needs: track` (`autotrack_acts`, `_daily`, `_episodes`) read autotrack's bucket in place, and are skipped with a note when `WREN_LAKE_TRACK_PATH` is unset.

## Why this shape

Prod tables mostly lack `updated_at`, so row hashes find changes and deletes. Snapshots are never expired: `wren lake sql --at` reads any day. CI runs it because the box has no memory to spare (`designs/2026-10-11-lake.md`).

## Steps

1. `.github/workflows/lake.yml` at 07:40 UTC: OIDC role, `pnpm -s wren lake sync --public`.
2. Per database, `syncDatabase` (`apps/cli/src/lake-sync.ts`): a fingerprint per table; equal to `meta.fingerprints`, skip.
3. Changed: keys and hashes over, the diff deleted and fetched by key, or the table reloaded past 5,000 rows and half; new columns added.
4. Columns ending `secret`, `password`, `token` are never read.
5. `compact()` folds small files; `pnpm -s wren lake build` rebuilds the models (`buildModels`, which fills `{{track_events}}` and `{{track_labels}}` from `apps/cli/src/lake-track.ts`). A failure posts to Discord.

## If you change this

- **Hits:** a renamed or dropped table or column changes the lake's next snapshot and any model reading it (`lake/models/`); a new secret column must match the name rule or it lands in the lake
- **Hits (outside):** autotrack's session and label shapes (`autotrack/designs/2026-10-13-autotrack.md`) are read by `lake/models/autotrack_*.sql` and `EVENT_COLUMNS`; the portal's `autotrack.ts` app events are their `app` rows
- **Does not hit:** prod reads or writes (the sync only reads)

## Surfaces

| Surface | Role |
|---|---|
| CI | runs it nightly |
| William, agents | `wren lake sql`, `lake status` |
