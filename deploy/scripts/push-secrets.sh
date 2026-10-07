#!/usr/bin/env bash
# Write the worker's secret env to SSM as one JSON object. Reads:
#   deploy/prod.env               KEY=VALUE lines (gitignored) — the Lambda's .env + llm.env
#   $WREN_GOOGLE_SERVICE_ACCOUNT  the key file named in prod.env (path); its JSON goes inline
#   ../senders_config.toml        the roster (gitignored) → its own parameter, when present
# Prints the names it wrote, never a value.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${1:-prod.env}"
PARAM="${WREN_SSM_ENV_PARAM:-/wren/prod/env}"
ROSTER_PARAM="${WREN_SSM_ROSTER_PARAM:-/wren/prod/senders_config}"
ROSTER="${WREN_SENDERS_FILE:-../senders_config.toml}"
[ -f "$ENV_FILE" ] || { echo "no $ENV_FILE — copy prod.env.example and fill it" >&2; exit 1; }

json="$(python3 - "$ENV_FILE" <<'PY'
import json, os, sys
env = {}
for line in open(sys.argv[1]):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1]
    if v and not v.startswith("#"):
        env[k.strip()] = v
sa = env.get("WREN_GOOGLE_SERVICE_ACCOUNT")
if sa and not sa.lstrip().startswith("{"):
    env["WREN_GOOGLE_SERVICE_ACCOUNT"] = open(os.path.expanduser(sa)).read()
# Compact: the parameter caps at 8192 characters (Advanced tier).
if env.get("WREN_GOOGLE_SERVICE_ACCOUNT", "").lstrip().startswith("{"):
    env["WREN_GOOGLE_SERVICE_ACCOUNT"] = json.dumps(json.loads(env["WREN_GOOGLE_SERVICE_ACCOUNT"]), separators=(",", ":"))
out = json.dumps(env, separators=(",", ":"))
if len(out) > 8192:
    sys.exit(f"{len(out)} characters, over SSM's 8192: nothing written")
print(out)
PY
)"
aws ssm put-parameter --name "$PARAM" --type SecureString --tier Advanced --overwrite \
  --value "$json" >/dev/null
echo "wrote $PARAM:"
python3 -c 'import json,sys; print("\n".join("  " + k for k in json.loads(sys.argv[1])))' "$json"

if [ -f "$ROSTER" ]; then
  # Plain String: the roster holds addresses and copy, no secrets, and a
  # SecureString read costs a KMS request on every Lambda cold start.
  aws ssm put-parameter --name "$ROSTER_PARAM" --type String --tier Advanced --overwrite \
    --value "file://$ROSTER" >/dev/null
  echo "wrote $ROSTER_PARAM: $(grep -c '^\[\[' "$ROSTER") roster entries"
else
  echo "no $ROSTER: roster parameter left as is"
fi
