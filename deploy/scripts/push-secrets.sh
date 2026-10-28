#!/usr/bin/env bash
# Write the worker's secret env to SSM as JSON objects: one parameter, or with
# WREN_SSM_ENV_PARTS=2 the names filled in order into $PARAM then $PARAM-2 (one caps at 8192
# characters; designs/2026-10-07-key-store.md, "Env cap"). Every part is written, an empty one
# as {}, so a name never lingers in two. Reads:
#   deploy/prod.env               KEY=VALUE lines (gitignored) — the Lambda's .env + llm.env
#   $WREN_GOOGLE_SERVICE_ACCOUNT  the key file named in prod.env (path); its JSON goes inline
#   ../senders_config.toml        the roster (gitignored) → its own parameter, when present
# Prints the names it wrote, never a value.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${1:-prod.env}"
PARAM="${WREN_SSM_ENV_PARAM:-/wren/prod/env}"
PARTS="${WREN_SSM_ENV_PARTS:-1}"
ROSTER_PARAM="${WREN_SSM_ROSTER_PARAM:-/wren/prod/senders_config}"
ROSTER="${WREN_SENDERS_FILE:-../senders_config.toml}"
[ -f "$ENV_FILE" ] || { echo "no $ENV_FILE — copy prod.env.example and fill it" >&2; exit 1; }
case "$PARTS" in [1-4]) ;; *) echo "WREN_SSM_ENV_PARTS is 1 to 4" >&2; exit 1 ;; esac

# Values go through files only this user can read, never argv.
umask 077
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The file is read by scripts/secrets.mjs's parse (node's rules, as the runtime reads it), never a
# second parser here: one that kept an inline `# note` pushed it into a value.
node -e 'import(require("node:url").pathToFileURL(process.argv[1])).then(({ parse }) => {
  const env = parse(require("node:fs").readFileSync(process.argv[2], "utf8"));
  for (const k of Object.keys(env)) if (env[k] === "") delete env[k];
  require("node:fs").writeFileSync(process.argv[3], JSON.stringify(env));
})' ../scripts/secrets.mjs "$ENV_FILE" "$tmp/file.json"

python3 - "$tmp/file.json" "$PARTS" "$tmp" <<'PY'
import json, os, sys
env = json.load(open(sys.argv[1]))
sa = env.get("WREN_GOOGLE_SERVICE_ACCOUNT")
if sa and not sa.lstrip().startswith("{"):
    env["WREN_GOOGLE_SERVICE_ACCOUNT"] = open(os.path.expanduser(sa)).read()
# Compact: the parameter caps at 8192 characters (Advanced tier).
if env.get("WREN_GOOGLE_SERVICE_ACCOUNT", "").lstrip().startswith("{"):
    env["WREN_GOOGLE_SERVICE_ACCOUNT"] = json.dumps(json.loads(env["WREN_GOOGLE_SERVICE_ACCOUNT"]), separators=(",", ":"))
# Fill in order: each name into the first part it still fits. Too big for every part: refuse.
CAP = 8192
parts = [{} for _ in range(int(sys.argv[2]))]
size = lambda d: len(json.dumps(d, separators=(",", ":")))
for k, v in env.items():
    for p in parts:
        if size({**p, k: v}) <= CAP:
            p[k] = v
            break
    else:
        total = size(env)
        sys.exit(f"{total} characters don't fit {len(parts)} part(s) of {CAP}: nothing written. "
                 "Raise WREN_SSM_ENV_PARTS (and add the parameter in lambda.tf).")
for i, p in enumerate(parts, 1):
    with open(os.path.join(sys.argv[3], f"part{i}.json"), "w") as f:
        f.write(json.dumps(p, separators=(",", ":")))
PY

# A name SSM holds that the file lacks would vanish (TURBO_*, the Wise keys live only in env-2):
# refuse, unless WREN_SSM_DROP lists it (comma-separated). Names compared, values never read out.
for i in $(seq 1 4); do
  name="$PARAM"
  [ "$i" -gt 1 ] && name="$PARAM-$i"
  aws ssm get-parameter --name "$name" --with-decryption --query Parameter.Value --output text \
    > "$tmp/live$i.json" 2>/dev/null || rm -f "$tmp/live$i.json"
done
[ -f "$tmp/live1.json" ] || { echo "can't read $PARAM, so can't check what a write would drop" >&2; exit 1; }
python3 - "$tmp" "${WREN_SSM_DROP:-}" <<'PY'
import glob, json, os, sys
live = set()
for f in glob.glob(os.path.join(sys.argv[1], "live*.json")):
    try:
        live |= set(json.load(open(f)))
    except ValueError:
        pass
new = set()
for f in glob.glob(os.path.join(sys.argv[1], "part*.json")):
    new |= set(json.load(open(f)))
gone = sorted(live - new - {n for n in sys.argv[2].split(",") if n})
if gone:
    sys.exit("nothing written: SSM holds names the file lacks, which would vanish:\n  "
             + "\n  ".join(gone) + "\nAdd them to the file, or list them in WREN_SSM_DROP to drop them.")
PY

for i in $(seq 1 "$PARTS"); do
  name="$PARAM"
  [ "$i" -gt 1 ] && name="$PARAM-$i"
  # The first stays Advanced as before; later ones pick their tier by size.
  tier="Advanced"
  [ "$i" -gt 1 ] && tier="Intelligent-Tiering"
  aws ssm put-parameter --name "$name" --type SecureString --tier "$tier" --overwrite \
    --value "file://$tmp/part$i.json" >/dev/null
  echo "wrote $name ($(wc -c < "$tmp/part$i.json" | tr -d ' ') characters):"
  python3 -c 'import json,sys; print("\n".join("  " + k for k in json.load(open(sys.argv[1]))))' \
    "$tmp/part$i.json"
done

if [ -f "$ROSTER" ]; then
  # Plain String: the roster holds addresses and copy, no secrets, and a
  # SecureString read costs a KMS request on every Lambda cold start.
  aws ssm put-parameter --name "$ROSTER_PARAM" --type String --tier Advanced --overwrite \
    --value "file://$ROSTER" >/dev/null
  echo "wrote $ROSTER_PARAM: $(grep -c '^\[\[' "$ROSTER") roster entries"
else
  echo "no $ROSTER: roster parameter left as is"
fi
