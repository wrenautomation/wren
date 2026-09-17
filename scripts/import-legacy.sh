#!/usr/bin/env bash
# Copy every row of the emails_gen Postgres into a wren database.
# The target must already be migrated (pnpm db:migrate). Rows are appended, so
# run it once, into an empty target. Sequences are advanced by the dump itself.
#
#   scripts/import-legacy.sh [target-db]   (default: wren)
set -euo pipefail
SRC_CONTAINER=${LEGACY_DB_CONTAINER:-emails_gen-db-1}
DST_CONTAINER=${WREN_DB_CONTAINER:-wren-postgres-1}
TARGET_DB=${1:-wren}

docker exec "$SRC_CONTAINER" pg_dump -U emailsgen -d emailsgen \
    --data-only --no-owner --no-privileges --disable-triggers \
    --exclude-table=alembic_version \
  | docker exec -i "$DST_CONTAINER" psql -U wren -d "$TARGET_DB" -v ON_ERROR_STOP=1 -q -o /dev/null
echo "imported into $TARGET_DB"
