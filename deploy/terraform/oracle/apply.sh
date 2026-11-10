#!/usr/bin/env bash
# Apply the Oracle work box. Keys from the store (autobrowse env, SSM /autobrowse/config), never a
# file in the repo. "Out of host capacity" is Oracle's A1 pool being full: walk the availability
# domains, then back off and try again (WA-1274: capacity, not a hung page).
#   ./apply.sh            # plan + apply, retries until the box exists or MAX_TRIES
#   ./apply.sh destroy
set -euo pipefail
cd "$(dirname "$0")"

MAX_TRIES="${MAX_TRIES:-60}"
WAIT_S="${WAIT_S:-120}"
NAMES=(OCI_TENANCY_OCID OCI_USER_OCID OCI_API_FINGERPRINT OCI_API_KEY_PEM_B64 WREN_WORK_SSH_PUBLIC_KEY
  AUTOBROWSE_CRED_ORACLE_USERNAME)

# values into this shell only; never printed
eval "$(autobrowse env pull --export "${NAMES[@]}" 2>/dev/null)"
for n in "${NAMES[@]}"; do
  [[ -n "${!n:-}" ]] || { echo "missing $n in the store (autobrowse env ls)" >&2; exit 1; }
done
export TF_VAR_tenancy_ocid="$OCI_TENANCY_OCID"
export TF_VAR_user_ocid="$OCI_USER_OCID"
export TF_VAR_fingerprint="$OCI_API_FINGERPRINT"
TF_VAR_private_key="$(printf %s "$OCI_API_KEY_PEM_B64" | base64 -d)"
export TF_VAR_private_key
export TF_VAR_ssh_public_key="$WREN_WORK_SSH_PUBLIC_KEY"
export TF_VAR_alert_email="$AUTOBROWSE_CRED_ORACLE_USERNAME" # the budget mails the account's owner
TF_VAR_user_data="$(cat ../../work-box/box-setup.sh)" # cloud-init: compose, runners (WA-1277)
export TF_VAR_user_data

tofu init -input=false -upgrade >/dev/null

if [[ "${1:-}" == "destroy" ]]; then
  exec tofu destroy -input=false -auto-approve
fi

log="$(mktemp)"
trap 'rm -f "$log"' EXIT
ads=3 # Ashburn has 3
for ((try = 0; try < MAX_TRIES; try++)); do
  ad=$((try % ads))
  echo "try $((try + 1))/$MAX_TRIES, AD $ad"
  if tofu apply -input=false -auto-approve -var "ad_index=$ad" 2>&1 | tee "$log"; then
    tofu output
    exit 0
  fi
  grep -qiE "out of (host )?capacity|InternalError.*capacity" "$log" || { echo "failed, not capacity" >&2; exit 1; }
  # a full pass over the ADs, then wait
  ((ad == ads - 1)) && sleep "$WAIT_S"
done
echo "no A1 capacity after $MAX_TRIES tries" >&2
exit 2
