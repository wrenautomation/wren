#!/usr/bin/env bash
# Ship the VPS stack to one RackNerd box (PROBE_HOST, default probe.wrenautomation.com;
# probe2.wrenautomation.com is the second): the one-file prober out of the installed
# mailifier package, the compose file, the Caddyfile and, when SEARCH_HOST is set (the
# default on box 1: search.wrenautomation.com), SearXNG behind its own site block. The box
# therefore runs exactly the versions this repo has pinned. The prober's host name is also
# its HELO, so its IP's PTR must name it; the script says so when it does not. The SSH key
# and the tokens come from SSM (/wren/prod/probe_ssh_key, probe_token, searxng_token,
# searxng_secret), shared by all boxes.
set -euo pipefail
cd "$(dirname "$0")/../.."
HOST="${PROBE_HOST:-probe.wrenautomation.com}"
# Box 1 runs search; another box gets it only when asked (SEARCH_HOST=name).
SEARCH="${SEARCH_HOST-$([ "$HOST" = probe.wrenautomation.com ] && echo search.wrenautomation.com || true)}"
DIR=/opt/wren-vps
# pnpm keeps a package next to the workspace member that depends on it.
BUNDLE=packages/channel-email/node_modules/mailifier/dist/mailifier.mjs
[ -f "$BUNDLE" ] || { echo "no $BUNDLE; run pnpm install" >&2; exit 1; }
IP="$(dig +short A "$HOST" | tail -1)"
PTR="$(dig +short -x "$IP" | sed 's/\.$//')"
[ "$PTR" = "$HOST" ] || echo "warning: PTR of $IP is '${PTR:-none}', not $HOST; keep it out of WREN_SMTP_PROBE_URL until it is" >&2
KEY="$(mktemp)"; trap 'rm -f "$KEY"' EXIT
ssm() { aws ssm get-parameter --name "$1" --with-decryption --query Parameter.Value --output text; }
ssm /wren/prod/probe_ssh_key > "$KEY"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "root@$HOST")
"${SSH[@]}" "mkdir -p $DIR/sites && rm -f $DIR/sites/*.caddy"
scp -q -i "$KEY" "$BUNDLE" "root@$HOST:$DIR/prober.mjs"
scp -q -i "$KEY" deploy/vps/compose.yml deploy/vps/Caddyfile deploy/vps/searxng.yml "root@$HOST:$DIR/"
ENV="PROBE_TOKEN=$(ssm /wren/prod/probe_token)\nPROBE_HOST=$HOST\n"
PROFILE=""
if [ -n "$SEARCH" ]; then
  scp -q -i "$KEY" deploy/vps/search.caddy "root@$HOST:$DIR/sites/"
  ENV="${ENV}SEARCH_HOST=$SEARCH\nSEARXNG_TOKEN=$(ssm /wren/prod/searxng_token)\nSEARXNG_SECRET=$(ssm /wren/prod/searxng_secret)\n"
  PROFILE="--profile search"
fi
# shellcheck disable=SC2059
printf "$ENV" | "${SSH[@]}" "umask 077; cat > $DIR/.env"
"${SSH[@]}" "cd $DIR && docker compose $PROFILE up -d --quiet-pull --force-recreate --remove-orphans >/dev/null && docker compose $PROFILE ps --format '{{.Service}} {{.State}}'"
wait_on() {
  for _ in $(seq 1 30); do
    curl -sf "https://$1/healthz" && { echo; return 0; }
    sleep 4
  done
  echo "https://$1/healthz did not answer" >&2; return 1
}
wait_on "$HOST"
[ -z "$SEARCH" ] || wait_on "$SEARCH"
