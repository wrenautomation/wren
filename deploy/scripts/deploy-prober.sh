#!/usr/bin/env bash
# Ship the prober to one RackNerd VPS (PROBE_HOST, default probe.wrenautomation.com;
# probe2.wrenautomation.com is the second): the one-file server out of the installed
# mailifier package, the compose file and the Caddyfile, over SSH. The box therefore runs
# exactly the version this repo has pinned. The host name is also its HELO, so its IP's
# PTR must name it; the script says so when it does not. The SSH key and the bearer
# token come from SSM (/wren/prod/probe_ssh_key, /wren/prod/probe_token), shared by all boxes.
set -euo pipefail
cd "$(dirname "$0")/../.."
HOST="${PROBE_HOST:-probe.wrenautomation.com}"
# pnpm keeps a package next to the workspace member that depends on it.
BUNDLE=packages/channel-email/node_modules/mailifier/dist/mailifier.mjs
[ -f "$BUNDLE" ] || { echo "no $BUNDLE; run pnpm install" >&2; exit 1; }
IP="$(dig +short A "$HOST" | tail -1)"
PTR="$(dig +short -x "$IP" | sed 's/\.$//')"
[ "$PTR" = "$HOST" ] || echo "warning: PTR of $IP is '${PTR:-none}', not $HOST; keep it out of WREN_SMTP_PROBE_URL until it is" >&2
KEY="$(mktemp)"; trap 'rm -f "$KEY"' EXIT
aws ssm get-parameter --name /wren/prod/probe_ssh_key --with-decryption \
  --query Parameter.Value --output text > "$KEY"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "root@$HOST")
"${SSH[@]}" mkdir -p /opt/wren-prober
scp -q -i "$KEY" "$BUNDLE" "root@$HOST:/opt/wren-prober/prober.mjs"
scp -q -i "$KEY" deploy/prober/compose.yml deploy/prober/Caddyfile "root@$HOST:/opt/wren-prober/"
aws ssm get-parameter --name /wren/prod/probe_token --with-decryption \
  --query Parameter.Value --output text \
  | "${SSH[@]}" "umask 077; printf 'PROBE_TOKEN=%s\nPROBE_HOST=%s\n' \"\$(cat)\" '$HOST' > /opt/wren-prober/.env"
"${SSH[@]}" 'cd /opt/wren-prober && docker compose up -d --quiet-pull --force-recreate --remove-orphans >/dev/null && docker compose ps --format "{{.Service}} {{.State}}"'
for _ in $(seq 1 30); do
  curl -sf "https://$HOST/healthz" && { echo; exit 0; }
  sleep 4
done
echo "https://$HOST/healthz did not answer" >&2; exit 1
