#!/bin/bash
# @unit restate: The box's own Restate server, for the pool chain.
# @unit desk-hop: The hop to the desk's Cloudflare Tunnel.
# Runs ON the Postgres box (first boot, or by hand over SSM): the Restate server, the hop to the
# desk's Cloudflare Tunnel, and the hourly Restate backup. Caddy is box-front-door.sh's. Idempotent:
# a container restarts only when its config changed. Goes when Restate stops (own-runtime phase 6b).
# Usage: box-restate.sh <region> <backups-bucket> [param]
# The param is SecureString JSON {"token": ingress bearer, "identity_pem": request-signing key}.
set -euo pipefail
region="$1" bucket="$2" param="${3:-/wren/prod/restate}"
D=/var/lib/wren-pg/restate
HOST=restate.wrenautomation.com
DESK=desk.wrenautomation.com
mkdir -p "$D/data"
umask 077

aws ssm get-parameter --region "$region" --name "$param" --with-decryption \
  --query Parameter.Value --output text \
  | python3 -c 'import json,sys; sys.stdout.write(json.load(sys.stdin)["identity_pem"])' > "$D/identity.pem.new"

# Admin, ingress and node-to-node stay on loopback; only Caddy (box-front-door.sh) faces out.
cat > "$D/config.toml.new" <<EOF
cluster-name = "wren"
node-name = "box"
base-dir = "/restate/data"
default-num-partitions = 4
rocksdb-total-memory-size = "256 MB"
request-identity-private-key-pem-file = "/restate/identity.pem"
bind-address = "127.0.0.1:5122"
advertised-address = "http://127.0.0.1:5122/"

# WA-1060: pinned to 1.7's defaults (--dump-config), so an upgrade cannot change them. About
# 1 h of retries, then pause: a failing call waits in the dead-letter queue, never dropped.
[default-retry-policy]
initial-interval = "500ms"
exponentiation-factor = 2.0
max-interval = "1m"
max-attempts = 70
on-max-attempts = "pause"

[admin]
bind-address = "127.0.0.1:9070"

[ingress]
bind-address = "127.0.0.1:8080"
advertised-ingress-endpoint = "https://$HOST/"

[worker.snapshots]
destination = "s3://$bucket/restate/snapshots"
EOF

# Swap a .new file in; say whether it changed.
changed() {
  if [ -f "$1" ] && cmp -s "$1" "$1.new"; then rm "$1.new"; return 1; fi
  mv "$1.new" "$1"
}
restate_cfg=0
changed "$D/identity.pem" && restate_cfg=1
changed "$D/config.toml" && restate_cfg=1

# (Re)start a container when it is missing, stopped, or its config changed.
up() { # name changed -- docker run args
  local name="$1" dirty="$2"
  shift 3
  if [ "$dirty" = 0 ] && [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" = true ]; then
    return 0
  fi
  docker stop "$name" >/dev/null 2>&1 || true
  docker rm "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" --restart unless-stopped --network host \
    --log-opt max-size=20m --log-opt max-file=3 "$@" >/dev/null
  echo "started $name"
}

# 2g: past 1g, recovery replay after a restart was OOM-killed every ~20 s (2026-10-10);
# it settles near 1g once caught up.
up wren-restate "$restate_cfg" -- --memory 2g --memory-swap 3g --stop-timeout 60 \
  -e AWS_REGION="$region" -v "$D":/restate \
  docker.restate.dev/restatedev/restate:1.7 --config-file /restate/config.toml
# The desk (autobrowse on the Mac) is served through its Cloudflare Tunnel as raw TCP:
# h2c streams, so a call longer than Cloudflare's 100 s HTTP limit still finishes. The
# server reaches it at 127.0.0.1:9082; the SDK there serves only calls this server signs.
up wren-desk-hop 0 -- --memory 64m \
  cloudflare/cloudflared:latest access tcp --hostname "$DESK" --url 127.0.0.1:9082

for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:9070/health >/dev/null && break
  sleep 2
done
curl -sf http://127.0.0.1:9070/health >/dev/null || { docker logs --tail 30 wren-restate 2>&1; exit 1; }

# Hourly (WA-1063, designs/2026-11-04-at-least-once.md): a partition snapshot (to
# restate/snapshots), then the data dir to a ring of 24 (hourly/<HH>, overwritten daily: a lost
# volume loses at most 1 h). The 08:30 one, after the Postgres dump, is also kept by date. The
# bucket expires restate/ after 7 days.
cat > /usr/local/bin/wren-restate-backup <<EOF
#!/bin/bash
set -euo pipefail
hour=\$(date -u +%H)
to="s3://$bucket/restate/data"
docker exec wren-restate restatectl snapshots create
tar -C $D -czf - data | aws s3 cp --region $region - "\$to/hourly/\$hour.tar.gz"
if [ "\$hour" = 08 ]; then
  aws s3 cp --region $region "\$to/hourly/08.tar.gz" "\$to/\$(date -u +%F).tar.gz"
fi
EOF
chmod 755 /usr/local/bin/wren-restate-backup
echo "30 * * * * root flock -n /run/wren-restate-backup.lock /usr/local/bin/wren-restate-backup >> /var/log/wren-restate-backup.log 2>&1" \
  > /etc/cron.d/wren-restate-backup
chmod 644 /etc/cron.d/wren-restate-backup
echo "restate up"
