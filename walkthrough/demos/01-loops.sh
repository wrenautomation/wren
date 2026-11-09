#!/bin/bash
# Every loop on Restate Cloud: running? when was the last pass, what did it do? Reads only.
set -uo pipefail
cd "$(dirname "$0")/../.."
T=$(grep '^RESTATE_AUTH_TOKEN=' .env | cut -d= -f2-)
[ -n "$T" ] || { echo "RESTATE_AUTH_TOKEN missing in .env" >&2; exit 1; }
U=${WREN_PROD_INGRESS_URL:-https://api.wrenautomation.com}
for o in PostPublish/default PostMetrics/default AdSpendGuard/default EmailOpenerFill/agencies \
         LeadPoolFill/agencies EmailPostmasterPull/fleet EmailFleetDigest/fleet EmailPlacementTest/fleet; do
  printf '%-32s ' "$o"
  curl -s -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' "$U/$o/status" -d '{}' \
    | python3 -c 'import json,sys
d=json.load(sys.stdin); l=d.get("last") or {}
print("running" if d.get("running") else "stopped", "| last", l.get("now","-"), "| stats", json.dumps(l.get("stats"))[:90], "| error", l.get("error"))' 2>/dev/null || echo "?"
done
