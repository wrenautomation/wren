#!/usr/bin/env bash
# Register the local worker (apps/worker on :9080) with the compose Restate server.
set -euo pipefail
ADMIN="${WREN_RESTATE_ADMIN_URL:-http://127.0.0.1:9070}"
curl -sf "$ADMIN/deployments" -H 'content-type: application/json' \
  -d '{"uri":"http://host.docker.internal:9080","force":true}' >/dev/null &&
echo "registered worker at $ADMIN"
