#!/bin/bash
# The zone side of client portals on their own hosts (designs/2026-10-06-custom-domains.md).
# Safe to rerun: each step checks first. Run with the tokens in env, never printed:
#   node scripts/secrets.mjs run deploy/prod.env -- deploy/scripts/custom-domains.sh
# Needs CLOUDFLARE_API_TOKEN (DNS + Workers Routes) and WREN_CLOUDFLARE_SAAS_TOKEN (SSL and
# Certificates). wren-portal's `*/*` route lives in apps/portal/wrangler.toml; this keeps the
# lander's apex and the desk off it.
set -euo pipefail
zone="${WREN_CLOUDFLARE_ZONE_ID:?}"
domain=wrenautomation.com
target="${WREN_CUSTOM_DOMAIN_TARGET:-customers.$domain}"
api="https://api.cloudflare.com/client/v4/zones/$zone"

cf() { # token method path [json]
  curl -sS -X "$2" -H "Authorization: Bearer $1" -H "content-type: application/json" \
    "$api$3" ${4:+--data "$4"}
}
ok() { python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("success") else (print(d.get("errors"), file=sys.stderr) or 1))'; }

# 1. The fallback origin: a proxied name with no server behind it (100:: discards). The Worker
#    answers before anything reaches it.
if cf "$CLOUDFLARE_API_TOKEN" GET "/dns_records?type=AAAA&name=$target" |
  python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin)["result"] else 1)'; then
  echo "dns: $target there"
else
  cf "$CLOUDFLARE_API_TOKEN" POST /dns_records \
    "{\"type\":\"AAAA\",\"name\":\"$target\",\"content\":\"100::\",\"proxied\":true,\"comment\":\"custom domains fallback origin\"}" | ok
  echo "dns: $target added"
fi

cf "$WREN_CLOUDFLARE_SAAS_TOKEN" PUT /custom_hostnames/fallback_origin "{\"origin\":\"$target\"}" | ok
echo "fallback origin: $target"

# 2. Our own proxied hosts that `*/*` would catch. A route with no script runs no Worker. app.,
#    auth., demo. and phone. are Worker custom domains and win anyway; t. and www. have routes.
routes="$(cf "$CLOUDFLARE_API_TOKEN" GET /workers/routes)"
for pattern in "$domain/*" "desk.$domain/*"; do
  if printf '%s' "$routes" | P="$pattern" python3 -c 'import json,os,sys; sys.exit(0 if any(r["pattern"]==os.environ["P"] for r in json.load(sys.stdin)["result"]) else 1)'; then
    echo "route: $pattern there"
  else
    cf "$CLOUDFLARE_API_TOKEN" POST /workers/routes "{\"pattern\":\"$pattern\"}" | ok
    echo "route: $pattern, no Worker"
  fi
done
