#!/usr/bin/env bash
# Set up the work box and register its GitHub Actions runners (designs/2026-11-10-work-box.md).
# Run from the Mac after the box exists, again after a rebuild, or to change the count.
#   ./register-runners.sh [ip] [count]    # ip: the oracle module's output; count: 4
# The registration token lives one hour and goes over ssh stdin: never in user_data, never printed.
# A registered runner keeps its own credential on the box, so a reboot needs nothing.
set -euo pipefail
cd "$(dirname "$0")"

REPO=wrenautomation/wren # repo-level: an org-level runner needs gh's admin:org scope
LABEL=wren-work
IP="${1:-$(tofu -chdir=../terraform/oracle output -raw ip)}"
COUNT="${2:-4}"

key=$(mktemp)
trap 'rm -f "$key"' EXIT
eval "$(autobrowse env pull --export WREN_WORK_SSH_KEY_B64 2>/dev/null)" # never printed
printf %s "${WREN_WORK_SSH_KEY_B64:-}" | base64 -d >"$key"
[ -s "$key" ] || { echo "missing WREN_WORK_SSH_KEY_B64 in the store" >&2; exit 1; }
chmod 600 "$key"
SSH=(ssh -i "$key" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "ubuntu@$IP")

"${SSH[@]}" 'cloud-init status --wait >/dev/null 2>&1 || true'
"${SSH[@]}" 'sudo bash -s' <box-setup.sh >/dev/null
echo "setup ok on $IP"

gh api -X POST "repos/$REPO/actions/runners/registration-token" -q .token |
  "${SSH[@]}" "sudo bash -c 'read -r TOKEN; set -euo pipefail
for i in \$(seq 1 $COUNT); do
  d=/home/runner/r\$i
  if [ ! -f \$d/.runner ]; then
    rm -rf \$d && cp -a /opt/actions-runner \$d && chown -R runner:runner \$d
    echo ACTIONS_RUNNER_HOOK_JOB_STARTED=/usr/local/bin/work-job-started >>\$d/.env
    cd \$d && sudo -u runner ./config.sh --unattended --url https://github.com/$REPO --token \"\$TOKEN\" \
      --name $LABEL-\$i --labels $LABEL --work _work --replace >/dev/null
    ./svc.sh install runner >/dev/null
  fi
  cd \$d && ./svc.sh start >/dev/null || true
done'"

gh api "repos/$REPO/actions/runners" -q '.runners[] | "\(.name) \(.status) \(.labels | map(.name) | join(","))"'
