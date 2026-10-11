#!/bin/bash
# Runs ON the Postgres box (CI sends it over SSM): Valkey on 6380, the shared cache
# (designs/2026-10-11-cache.md). TLS on the box's self-signed certificate; the client pins its
# fingerprint, printed last. One login, allowed GET, SET, DEL and PING on wren:* keys only.
# Nothing is saved to disk: a restart empties it, and every read goes back to Postgres.
# Same config and running: left alone. CI logs are public: never print the password.
# Usage: box-valkey.sh <region> [param]   (param: SecureString JSON {"password": ...})
set -euo pipefail
region="$1" param="${2:-/wren/prod/cache}"
dir=/var/lib/wren-pg/valkey
image=valkey/valkey:8.1.1-alpine

pw="$(aws ssm get-parameter --region "$region" --name "$param" --with-decryption \
  --query Parameter.Value --output text |
  python3 -c 'import json,sys; sys.stdout.write(json.load(sys.stdin).get("password",""))')"
if [ ${#pw} -lt 32 ]; then
  echo "valkey: $param has no password of 32+ characters; left as is" >&2
  exit 1
fi

umask 077
rm -rf "$dir.new" && mkdir -p "$dir.new"
cp /var/lib/wren-pg/tls/server.crt /var/lib/wren-pg/tls/server.key "$dir.new/"
cat > "$dir.new/valkey.conf" <<CONF
port 0
tls-port 6380
tls-cert-file /etc/valkey/server.crt
tls-key-file /etc/valkey/server.key
tls-auth-clients no
user default on >$pw ~wren:* resetchannels -@all +get +set +del +ping
maxmemory 64mb
maxmemory-policy allkeys-lru
save ""
appendonly no
CONF
unset pw
# The image runs as valkey (999).
chown -R 999:999 "$dir.new" && chmod 600 "$dir.new"/*

fingerprint() { openssl x509 -in "$dir/server.crt" -noout -fingerprint -sha256 | cut -d= -f2; }

if [ -d "$dir" ] && diff -rq "$dir" "$dir.new" >/dev/null 2>&1 &&
  [ "$(docker inspect -f '{{.State.Running}}' wren-valkey 2>/dev/null)" = true ]; then
  rm -rf "$dir.new"
  echo "valkey unchanged, left running; fp $(fingerprint)"
  exit 0
fi
rm -rf "$dir" && mv "$dir.new" "$dir"

# A restart empties the cache: reads go to Postgres until it fills again.
docker pull -q "$image" >/dev/null
docker rm -f wren-valkey >/dev/null 2>&1 || true
docker run -d --name wren-valkey --restart unless-stopped --memory 128m \
  -p 6380:6380 -v "$dir:/etc/valkey:ro" "$image" valkey-server /etc/valkey/valkey.conf >/dev/null
for _ in $(seq 1 20); do
  [ "$(docker inspect -f '{{.State.Running}}' wren-valkey 2>/dev/null)" = true ] && break
  sleep 0.5
done
docker inspect -f '{{.State.Running}}' wren-valkey | grep -q true
echo "valkey started; fp $(fingerprint)"
