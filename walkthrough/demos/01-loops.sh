#!/bin/bash
# Every loop on Restate Cloud: running? when was the last pass, what did it do? Reads only.
set -uo pipefail
cd "$(dirname "$0")/../.."
T=$(grep '^RESTATE_AUTH_TOKEN=' .env | cut -d= -f2-)
[ -n "$T" ] || { echo "RESTATE_AUTH_TOKEN missing in .env" >&2; exit 1; }
U=${WREN_PROD_INGRESS_URL:-https://201m2vp6sq3x11xdaatsmjej302.env.us.restate.cloud:8080}
for o in ContentScheduler/default ContentMetrics/default AdsWatch/default ComposeScheduler/agencies \
         PoolScheduler/agencies PostmasterScheduler/fleet OpensScheduler/fleet DigestScheduler/fleet ReportScheduler/weekly; do
  printf '%-32s ' "$o"
  curl -s -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' "$U/$o/status" -d '{}' \
    | python3 -c 'import json,sys
d=json.load(sys.stdin); l=d.get("last") or {}
print("running" if d.get("running") else "stopped", "| last", l.get("now","-"), "| stats", json.dumps(l.get("stats"))[:90], "| error", l.get("error"))' 2>/dev/null || echo "?"
done
