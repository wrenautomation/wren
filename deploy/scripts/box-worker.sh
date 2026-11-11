#!/bin/bash
# @unit worker: The runtime (apps/worker/src/rt.ts), on the box: its lanes and its door.
# Runs ON the Postgres box (CI sends it over SSM): install a worker bundle and
# (re)start the worker. Usage: box-worker.sh <bucket> <key>
set -euo pipefail
bucket="$1" key="$2"

# Headroom beside Postgres and the browser on a 4 GB box: a 2 GB swap file on the
# data volume (the 8 GB root has no room for it). Swap is the crash buffer, not memory to
# scale on: swappiness 10 keeps Postgres' pages in RAM until a spike, and a box that lives
# in swap gets a bigger instance. The Lambda has no swap; it scales by memory size.
SWAP=/var/lib/wren-pg/swapfile SWAP_MB=2048
if [ -f "$SWAP" ] && [ "$(stat -c %s "$SWAP")" -ne $((SWAP_MB * 1048576)) ]; then
  swapoff "$SWAP" 2>/dev/null || true
  rm -f "$SWAP"
fi
if ! swapon --show | grep -q "$SWAP"; then
  [ -f "$SWAP" ] || { dd if=/dev/zero of="$SWAP" bs=1M count="$SWAP_MB" status=none; chmod 600 "$SWAP"; mkswap "$SWAP" >/dev/null; }
  swapon "$SWAP"
  grep -q "$SWAP" /etc/fstab || echo "$SWAP swap swap defaults,nofail 0 0" >> /etc/fstab
fi
echo "vm.swappiness = 10" > /etc/sysctl.d/90-wren-swap.conf
sysctl -q -p /etc/sysctl.d/90-wren-swap.conf

# Two slots (apps/worker/src/box-slot.ts): the new build starts beside the live one, on the
# other port, and takes every new row. A row pinned to the live build finishes on its code; one
# build for every row replayed such rows on new code (journal mismatch, 10-16).
# The live container is always `wren-worker`; the one before it, `wren-worker-old`, serves its
# pinned rows until the next deploy replaces it.
live_port=9080 live_dir="" live_build=""
if docker inspect wren-worker >/dev/null 2>&1; then
  live_port="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' wren-worker | sed -n 's/^WREN_BOX_PORT=//p')"
  live_port="${live_port:-9080}"
  live_dir="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app"}}{{.Source}}{{end}}{{end}}' wren-worker)"
  live_build="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' wren-worker | sed -n 's/^WREN_BUILD=//p')"
fi
if [ "$live_port" = 9080 ]; then port=9081; else port=9080; fi
dir="/opt/wren-worker-$port"

aws s3 cp --only-show-errors "s3://$bucket/$key" /tmp/wren-worker.zip
rm -rf /opt/wren-worker.new && mkdir -p /opt/wren-worker.new
python3 -m zipfile -e /tmp/wren-worker.zip /opt/wren-worker.new
rm -f /tmp/wren-worker.zip

# The same bundle, script and env as the running worker: leave it be. A restart cuts any turn
# mid-run; it runs again only when its lease ends.
# Env = SSM versions: the worker reads SSM once at start, so a new version needs a new slot.
ssm_env=/wren/prod/env,/wren/prod/env-2,/wren/prod/env-3,/wren/prod/keystore
versions=""
for p in ${ssm_env//,/ }; do
  versions+="$p=$(aws ssm get-parameter --region us-east-1 --name "$p" --query Parameter.Version --output text);"
done
script="$(sha256sum "$0" | cut -c1-64) $(sha256sum <<<"$versions" | cut -c1-16)"
if [ -n "$live_dir" ] && [ "$(cat /opt/wren-worker.script 2>/dev/null)" = "$script" ] &&
  diff -rq "$live_dir" /opt/wren-worker.new >/dev/null 2>&1 &&
  [ "$(docker inspect -f '{{.State.Running}}' wren-worker 2>/dev/null)" = true ]; then
  rm -rf /opt/wren-worker.new
  echo "box worker unchanged, left running"
  exit 0
fi

# The slot's build from two deploys ago: rows still pinned to it replay on this build (rt.ts).
# stop, not rm -f: SIGTERM lets it finish turns in flight first.
for c in wren-worker-new wren-worker-old; do
  docker stop "$c" >/dev/null 2>&1 || true
  docker rm "$c" >/dev/null 2>&1 || true
done
rm -rf "$dir" && mv /opt/wren-worker.new "$dir"
# The Lambda version ARN CI publishes (deploy.sh "register"); the rt's lambda lane pins rows to it.
mkdir -p /etc/wren

docker run -d --name wren-worker-new --restart unless-stopped --init \
  --network host --memory 640m --stop-timeout 60 \
  --log-opt max-size=20m --log-opt max-file=3 \
  -v "$dir":/app:ro -w /app \
  -e AWS_REGION=us-east-1 \
  -e WREN_BOX_PORT="$port" \
  -e WREN_BUILD="$key" -e WREN_BUILD_LIVE="$live_build" \
  -v /etc/wren:/etc/wren:ro \
  -e WREN_BUNDLE_ROOT=/app \
  -e WREN_SSM_ENV_PARAM="$ssm_env" \
  -e WREN_SSM_ROSTER_PARAM=/wren/prod/senders_config \
  -e WREN_SSM_MAILBOXES_PARAM=/wren/prod/mailboxes \
  -e WREN_SSM_BOX_PARAM=/wren/prod/box \
  -e WREN_RENDERER=lambda -e WREN_RENDER_FUNCTION=wren-prod-render \
  -e WREN_DATABASE_POOL_PORT=6432 \
  -e WREN_LOG_LEVEL=info \
  -e NODE_OPTIONS=--max-old-space-size=448 \
  node:22-slim node app/box.mjs >/dev/null

# Up = its lanes and door run ("box ready"). CI logs are public: print names and messages only.
brief='import json,sys
for l in sys.stdin:
    try: j=json.loads(l)
    except ValueError: continue
    e=j.get("err") or ""
    e=e.get("message","") if isinstance(e,dict) else str(e)
    print(j.get("msg",""), j.get("port",""), j.get("door",""), e[:200])'
for _ in $(seq 1 30); do
  sleep 2
  if docker logs wren-worker-new 2>&1 | grep -q '"box ready"'; then
    docker logs wren-worker-new 2>&1 | grep '"box ready"' | tail -1 | python3 -c "$brief"
    # The live build becomes the old one: it never restarts on its own (a restart would make it
    # the newest build again, rt.box_builds), and the next deploy removes it.
    if docker inspect wren-worker >/dev/null 2>&1; then
      docker update --restart=no wren-worker >/dev/null
      docker rename wren-worker wren-worker-old
    fi
    docker rename wren-worker-new wren-worker
    echo "$script" > /opt/wren-worker.script
    # Bundles no container runs (the one-slot layout's included).
    keep="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app"}}{{.Source}}{{end}}{{end}}' wren-worker wren-worker-old 2>/dev/null || true)"
    for d in /opt/wren-worker /opt/wren-worker.old /opt/wren-worker-9080 /opt/wren-worker-9081; do
      if [ -d "$d" ] && ! grep -qx "$d" <<<"$keep"; then rm -rf "$d"; fi
    done
    exit 0
  fi
  [ "$(docker inspect -f '{{.State.Running}}' wren-worker-new)" = true ] || break
done
docker logs --tail 40 wren-worker-new 2>&1 | python3 -c "$brief"
# The new build never came up: the live one keeps the rows. A restart makes it the newest build
# again, in case the new one got as far as starting (it then stood down).
docker rm -f wren-worker-new >/dev/null 2>&1 || true
docker restart wren-worker >/dev/null 2>&1 || true
exit 1
