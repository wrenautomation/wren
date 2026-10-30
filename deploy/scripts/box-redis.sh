#!/bin/bash
# @unit redis: The shared cache; holds the Restate admin reads for 5 minutes.
# Runs ON the Postgres box (CI sends it over SSM): Redis on 6380, the shared cache
# (designs/2026-10-11-cache.md). TLS on the box's self-signed certificate; the client pins its
# fingerprint, printed last. One login, allowed GET, SET, DEL and PING on wren:* keys only.
# Nothing is saved to disk: a restart empties it, and every read goes back to Postgres.
# Same config and running: left alone. CI logs are public: never print the password.
# The config between the CONF lines is the one packages/core/test/integration/cache.test.ts runs.
# Usage: box-redis.sh <region> [param]   (param: SecureString JSON {"password": ...})
set -euo pipefail
region="$1" param="${2:-/wren/prod/cache}"
dir=/var/lib/wren-pg/redis
image=redis:8.10.1-alpine

pw="$(aws ssm get-parameter --region "$region" --name "$param" --with-decryption \
  --query Parameter.Value --output text |
  python3 -c 'import json,sys; sys.stdout.write(json.load(sys.stdin).get("password",""))')"
if [ ${#pw} -lt 32 ]; then
  echo "redis: $param has no password of 32+ characters; left as is" >&2
  exit 1
fi

umask 077
rm -rf "$dir.new" && mkdir -p "$dir.new"
cp /var/lib/wren-pg/tls/server.crt /var/lib/wren-pg/tls/server.key "$dir.new/"
cat > "$dir.new/redis.conf" <<CONF
port 0
tls-port 6380
tls-cert-file /etc/redis/server.crt
tls-key-file /etc/redis/server.key
tls-auth-clients no
user default on >$pw ~wren:* resetchannels -@all +get +set +del +ping
maxmemory 64mb
maxmemory-policy allkeys-lru
save ""
appendonly no
CONF
unset pw
# The image runs as redis (999).
chown -R 999:999 "$dir.new" && chmod 600 "$dir.new"/*

fingerprint() { openssl x509 -in "$dir/server.crt" -noout -fingerprint -sha256 | cut -d= -f2; }

if [ -d "$dir" ] && diff -rq "$dir" "$dir.new" >/dev/null 2>&1 &&
  [ "$(docker inspect -f '{{.State.Running}}' wren-redis 2>/dev/null)" = true ]; then
  rm -rf "$dir.new"
  echo "redis unchanged, left running; fp $(fingerprint)"
  exit 0
fi
rm -rf "$dir" && mv "$dir.new" "$dir"

# A restart empties the cache: reads go to Postgres until it fills again.
docker pull -q "$image" >/dev/null
# wren-valkey: the cache before 10-30, on the same port.
docker rm -f wren-valkey wren-redis >/dev/null 2>&1 || true
rm -rf /var/lib/wren-pg/valkey
docker run -d --name wren-redis --restart unless-stopped --memory 128m \
  -p 6380:6380 -v "$dir:/etc/redis:ro" "$image" redis-server /etc/redis/redis.conf >/dev/null
for _ in $(seq 1 20); do
  [ "$(docker inspect -f '{{.State.Running}}' wren-redis 2>/dev/null)" = true ] && break
  sleep 0.5
done
docker inspect -f '{{.State.Running}}' wren-redis | grep -q true
echo "redis started; fp $(fingerprint)"
