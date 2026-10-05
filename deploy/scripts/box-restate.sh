#!/bin/bash
# Runs ON the Postgres box (first boot, CI over SSM, or by hand over SSM): the Restate
# server, Caddy in front of its ingress, the hop to the desk's Cloudflare Tunnel, and the
# nightly Restate backup. Idempotent: a container restarts only when its config changed.
# Usage: box-restate.sh <region> <backups-bucket> [param]
# The param is SecureString JSON {"token": ingress bearer, "identity_pem": request-signing key}.
set -euo pipefail
region="$1" bucket="$2" param="${3:-/wren/prod/restate}"
D=/var/lib/wren-pg/restate
HOST=restate.wrenautomation.com
DESK=desk.wrenautomation.com
mkdir -p "$D/data" "$D/caddy"
umask 077

secrets="$(aws ssm get-parameter --region "$region" --name "$param" --with-decryption \
  --query Parameter.Value --output text)"
field() { python3 -c 'import json,sys; sys.stdout.write(json.loads(sys.argv[1])[sys.argv[2]])' "$secrets" "$1"; }
field identity_pem > "$D/identity.pem.new"
printf 'RESTATE_AUTH_TOKEN=%s\n' "$(field token)" > "$D/caddy.env.new"
unset secrets

# Admin, ingress and node-to-node stay on loopback; only Caddy faces out.
cat > "$D/config.toml.new" <<EOF
cluster-name = "wren"
node-name = "box"
base-dir = "/restate/data"
default-num-partitions = 4
rocksdb-total-memory-size = "512 MB"
request-identity-private-key-pem-file = "/restate/identity.pem"
bind-address = "127.0.0.1:5122"
advertised-address = "http://127.0.0.1:5122/"

[admin]
bind-address = "127.0.0.1:9070"

[ingress]
bind-address = "127.0.0.1:8080"
advertised-ingress-endpoint = "https://$HOST/"

[worker.snapshots]
destination = "s3://$bucket/restate/snapshots"
EOF

# The bearer opens the ingress and two admin reads the console needs (SQL over state,
# the service list). Every other admin call stays loopback-only: CI and the desk
# register over SSM.
cat > "$D/Caddyfile.new" <<EOF
$HOST {
	@authed header Authorization "Bearer {\$RESTATE_AUTH_TOKEN}"
	@query {
		method POST
		path /admin/query
	}
	@services {
		method GET
		path /admin/services /admin/services/*
	}
	handle @authed {
		handle @query {
			uri strip_prefix /admin
			reverse_proxy 127.0.0.1:9070
		}
		handle @services {
			uri strip_prefix /admin
			reverse_proxy 127.0.0.1:9070
		}
		handle /admin* {
			respond 403
		}
		handle {
			reverse_proxy 127.0.0.1:8080
		}
	}
	handle {
		respond 401
	}
}
EOF

# Swap a .new file in; say whether it changed.
changed() {
  if [ -f "$1" ] && cmp -s "$1" "$1.new"; then rm "$1.new"; return 1; fi
  mv "$1.new" "$1"
}
restate_cfg=0 caddy_cfg=0
changed "$D/identity.pem" && restate_cfg=1
changed "$D/config.toml" && restate_cfg=1
changed "$D/caddy.env" && caddy_cfg=1
changed "$D/Caddyfile" && caddy_cfg=1

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

up wren-restate "$restate_cfg" -- --memory 1g --stop-timeout 60 \
  -e AWS_REGION="$region" -v "$D":/restate \
  docker.restate.dev/restatedev/restate:1.7 --config-file /restate/config.toml
up wren-caddy "$caddy_cfg" -- --memory 128m --env-file "$D/caddy.env" \
  -v "$D/Caddyfile":/etc/caddy/Caddyfile:ro -v "$D/caddy":/data \
  caddy:2
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

# Nightly, after the Postgres dump: a partition snapshot (to restate/snapshots), then the
# data dir as one dated tarball. The bucket expires restate/ after 7 days.
cat > /usr/local/bin/wren-restate-backup <<EOF
#!/bin/bash
set -euo pipefail
docker exec wren-restate restatectl snapshots create
tar -C $D -czf - data | aws s3 cp --region $region - "s3://$bucket/restate/data/\$(date -u +%F).tar.gz"
EOF
chmod 755 /usr/local/bin/wren-restate-backup
echo "30 8 * * * root /usr/local/bin/wren-restate-backup >> /var/log/wren-restate-backup.log 2>&1" \
  > /etc/cron.d/wren-restate-backup
chmod 644 /etc/cron.d/wren-restate-backup
echo "restate up"
