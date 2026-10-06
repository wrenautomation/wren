#!/bin/bash
# Run one `wren` command against production: the prod database (from terraform) and the
# Restate Cloud ingress (docs/restate-operations.md; bearer from RESTATE_AUTH_TOKEN in .env). Nothing is printed but the
# command's own output.  Usage: walkthrough/demos/prod.sh content results --days 7
set -euo pipefail
cd "$(dirname "$0")/../.."
URL=$(cd deploy/terraform && tofu output -raw database_url)
INGRESS=${WREN_PROD_INGRESS_URL:-https://restate.wrenautomation.com}
WREN_DATABASE_URL="$URL" WREN_RESTATE_INGRESS_URL="$INGRESS" exec pnpm -s wren "$@"
