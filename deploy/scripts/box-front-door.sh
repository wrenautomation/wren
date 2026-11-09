#!/bin/bash
# @unit front-door: Caddy, the box's one public door: TLS, the bearer, failover between worker slots.
# Runs ON the Postgres box (CI over SSM each deploy, or by hand). Idempotent: Caddy reloads when only
# its Caddyfile changed (calls in flight keep going), restarts when its env changed.
#   api.wrenautomation.com (restate. is the old name, kept until every caller moves): the bearer, then
#     the door of the newest worker slot (9090/9091, apps/worker/src/rt.ts). A door that fails its
#     health check drops out (a superseded slot drains). POSTs retry only when Caddy could not connect,
#     so no call runs twice. /cdp: the box browser; it checks its own token, so it sits before the bearer.
#   127.0.0.1:8090: the same door for callers on the box (Listmonk's postback), no bearer, loopback only.
#   lists.wrenautomation.com: Listmonk (box-listmonk.sh).
# Design: designs/2026-11-09-own-runtime.md, "Phase 6: one front door".
# Usage: box-front-door.sh <region> [param]. The param is SecureString JSON {"token": the bearer}.
set -euo pipefail
region="$1" param="${2:-/wren/prod/restate}"
D=/var/lib/wren-pg/front-door
mkdir -p "$D/caddy"
umask 077
# Certificates and ACME account from the old home (Restate's, before 11-09), so none is issued again.
if [ ! -e "$D/caddy/caddy" ] && [ -d /var/lib/wren-pg/restate/caddy/caddy ]; then
  cp -a /var/lib/wren-pg/restate/caddy/. "$D/caddy/"
fi

token="$(aws ssm get-parameter --region "$region" --name "$param" --with-decryption \
  --query Parameter.Value --output text | python3 -c 'import json,sys; sys.stdout.write(json.load(sys.stdin)["token"])')"
printf 'DOOR_TOKEN=%s\n' "$token" > "$D/door.env.new"
unset token

cat > "$D/Caddyfile.new" <<'EOF'
(door) {
	reverse_proxy 127.0.0.1:9090 127.0.0.1:9091 {
		lb_policy first
		lb_try_duration 5s
		lb_try_interval 250ms
		health_uri /restate/health
		health_interval 5s
		health_timeout 3s
		flush_interval -1
	}
}

api.wrenautomation.com, restate.wrenautomation.com {
	handle /cdp {
		uri strip_prefix /cdp
		reverse_proxy 127.0.0.1:3000
	}
	@authed header Authorization "Bearer {$DOOR_TOKEN}"
	handle @authed {
		import door
	}
	handle {
		respond 401
	}
}

http://:8090 {
	bind 127.0.0.1
	import door
}

lists.wrenautomation.com {
	@public path /subscription* /api/public* /archive* /link/* /campaign/* /public/*
	respond @public 404
	reverse_proxy 127.0.0.1:9000
}
EOF

# Swap a .new file in; say whether it changed.
changed() {
  if [ -f "$1" ] && cmp -s "$1" "$1.new"; then rm "$1.new"; return 1; fi
  mv "$1.new" "$1"
}
# In place: the container bind-mounts this one file, and a moved-in file is a new inode it never sees.
changed_in_place() {
  if [ -f "$1" ] && cmp -s "$1" "$1.new"; then rm "$1.new"; return 1; fi
  cat "$1.new" > "$1" && rm "$1.new"
}
# a bad file never goes in
docker run --rm -v "$D/Caddyfile.new":/etc/caddy/Caddyfile:ro -e DOOR_TOKEN=x caddy:2 \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
env_changed=0 file_changed=0
changed "$D/door.env" && env_changed=1
changed_in_place "$D/Caddyfile" && file_changed=1

mounted="$(docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' wren-caddy 2>/dev/null || true)"
running="$(docker inspect -f '{{.State.Running}}' wren-caddy 2>/dev/null || true)"
# A first run here or a new env: restart on these files.
if [ "$running" != true ] || [ "$env_changed" = 1 ] || [[ "$mounted" != *"$D/Caddyfile"* ]]; then
  docker stop wren-caddy >/dev/null 2>&1 || true
  docker rm wren-caddy >/dev/null 2>&1 || true
  docker run -d --name wren-caddy --restart unless-stopped --network host \
    --log-opt max-size=20m --log-opt max-file=3 --memory 128m --env-file "$D/door.env" \
    -v "$D/Caddyfile":/etc/caddy/Caddyfile:ro -v "$D/caddy":/data caddy:2 >/dev/null
  echo "started wren-caddy"
elif [ "$file_changed" = 1 ]; then
  docker exec wren-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  echo "reloaded wren-caddy"
fi
for _ in $(seq 1 30); do
  curl -s -o /dev/null http://127.0.0.1:8090/restate/health && break
  sleep 1
done
echo "front door up"
