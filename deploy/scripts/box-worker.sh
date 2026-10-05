#!/bin/bash
# Runs ON the Postgres box (CI sends it over SSM): install a worker bundle and
# (re)start the pool chain's worker. Usage: box-worker.sh <bucket> <key>
# The container registers itself with the box's Restate server (loopback only), or dials
# Restate Cloud's tunnel when /wren/prod/box names one.
set -euo pipefail
bucket="$1" key="$2"
dir=/opt/wren-worker

# Headroom beside Postgres and the browser on a 2 GB box: a swap file, made once, on the
# data volume (the 8 GB root has no room for it).
SWAP=/var/lib/wren-pg/swapfile
if ! swapon --show | grep -q "$SWAP"; then
  [ -f "$SWAP" ] || { dd if=/dev/zero of="$SWAP" bs=1M count=1024 status=none; chmod 600 "$SWAP"; mkswap "$SWAP" >/dev/null; }
  swapon "$SWAP"
  grep -q "$SWAP" /etc/fstab || echo "$SWAP swap swap defaults,nofail 0 0" >> /etc/fstab
fi

aws s3 cp --only-show-errors "s3://$bucket/$key" /tmp/wren-worker.zip
rm -rf "$dir.new" && mkdir -p "$dir.new"
python3 -m zipfile -e /tmp/wren-worker.zip "$dir.new"
rm -f /tmp/wren-worker.zip
rm -rf "$dir.old" && { [ -d "$dir" ] && mv "$dir" "$dir.old" || true; } && mv "$dir.new" "$dir"

# stop, not rm -f: SIGTERM lets the tunnel drain in-flight invocations first.
docker stop wren-worker >/dev/null 2>&1 || true
docker rm wren-worker >/dev/null 2>&1 || true
docker run -d --name wren-worker --restart unless-stopped --init \
  --network host --memory 640m --stop-timeout 60 \
  --log-opt max-size=20m --log-opt max-file=3 \
  -v "$dir":/app:ro -w /app \
  -e AWS_REGION=us-east-1 \
  -e WREN_BUNDLE_ROOT=/app \
  -e WREN_SSM_ENV_PARAM=/wren/prod/env \
  -e WREN_SSM_ROSTER_PARAM=/wren/prod/senders_config \
  -e WREN_SSM_MAILBOXES_PARAM=/wren/prod/mailboxes \
  -e WREN_SSM_BOX_PARAM=/wren/prod/box \
  -e WREN_RENDERER=cdp \
  -e WREN_LOG_LEVEL=info \
  -e NODE_OPTIONS=--max-old-space-size=448 \
  node:22-slim node app/box.mjs >/dev/null

# Up = registered with Restate. CI logs are public: print names and messages only.
brief='import json,sys
for l in sys.stdin:
    try: j=json.loads(l)
    except ValueError: continue
    e=(j.get("err") or {}).get("message","")
    print(j.get("msg",""), j.get("deployment",""), ",".join(j.get("services",[])), e[:200])'
for _ in $(seq 1 30); do
  sleep 2
  if docker logs wren-worker 2>&1 | grep -q '"box ready"'; then
    docker logs wren-worker 2>&1 | grep '"box ready"' | tail -1 | python3 -c "$brief"
    exit 0
  fi
  [ "$(docker inspect -f '{{.State.Running}}' wren-worker)" = true ] || break
done
docker logs --tail 40 wren-worker 2>&1 | python3 -c "$brief"
exit 1
