# Helpers for .github/workflows/deploy.yml, sourced by its steps. Background work outlives
# its step (the runner reaps it at job end), so a later step can wait on it by name.
#   bg <name> <cmd...>     run in the background; log and exit code in $RUNNER_TEMP/bg
#   await <name...>        wait for each, print its log, fail if any failed
#   ssm_run <comment> <file.json>   run a command doc on the box, print its output, fail unless Success
#   box_script <name> <script> [args...]   install deploy/scripts/<script> on the box as wren-box-<name> and run it
D="$RUNNER_TEMP/bg"
mkdir -p "$D"

bg() {
  n=$1; shift
  # set +e: the step shell's -e would end the subshell before it writes the exit code.
  # Its own stdio off the step's pipes, or the runner waits for it before the step ends.
  ( set +e; "$@" > "$D/$n.log" 2>&1; echo $? > "$D/$n.rc" ) > /dev/null 2>&1 < /dev/null &
}

await() {
  failed=
  for n in "$@"; do
    while [ ! -s "$D/$n.rc" ]; do sleep 1; done
    rc=$(cat "$D/$n.rc")
    echo "::group::$n (exit $rc)"; cat "$D/$n.log"; echo "::endgroup::"
    [ "$rc" = 0 ] || failed="$failed $n"
  done
  [ -z "$failed" ] || { echo "::error::failed:$failed"; return 1; }
}

# Polls each second: `aws ssm wait` polls every 5.
ssm_run() {
  id="$(aws ssm send-command --instance-ids "$BOX_INSTANCE_ID" --document-name AWS-RunShellScript \
    --comment "$1 $GITHUB_SHA" --parameters "file://$2" --query Command.CommandId --output text)"
  while :; do
    out="$(aws ssm get-command-invocation --command-id "$id" --instance-id "$BOX_INSTANCE_ID" \
      --query '[Status,StandardOutputContent,StandardErrorContent]' --output text 2>/dev/null)" || out=Pending
    case "$out" in Pending* | InProgress* | Delayed*) sleep 1 ;; *) break ;; esac
  done
  printf '%s\n' "$out"
  case "$out" in Success*) ;; *) return 1 ;; esac
}

box_script() {
  n=$1 s=$2; shift 2
  b="$(base64 -w0 "deploy/scripts/$s")"
  jq -n --arg s "$b" --arg n "$n" --arg a "$*" '{commands: [
    "echo \($s) | base64 -d > /usr/local/bin/wren-box-\($n)",
    "chmod +x /usr/local/bin/wren-box-\($n)",
    "/usr/local/bin/wren-box-\($n) \($a)"]}' > "$RUNNER_TEMP/$n.json"
  ssm_run "$n" "$RUNNER_TEMP/$n.json"
}

# A Cloudflare Worker in two halves, so none goes live before the worker Restate runs:
# cf_upload builds and uploads a version (not live); cf_flip sends it all traffic, then applies routes.
# A version with a new Durable Object migration cannot upload: cf_flip runs a full deploy for it.
#   cf_upload <app> [secrets.json]    cf_flip <app> [secrets.json]
cf_upload() {
  app=$1 sec=${2:-}
  cd "apps/$app" || return 1
  if [ -n "$(jq -r '.scripts.build // empty' package.json)" ]; then pnpm run build || return 1; fi
  # The version id from wrangler's own record of the upload (WRANGLER_OUTPUT_FILE_PATH, one JSON per line).
  if WRANGLER_OUTPUT_FILE_PATH="$D/$app.ndjson" npx wrangler versions upload --tag "${GITHUB_SHA:0:12}" \
    ${sec:+--secrets-file "$sec"} > "$D/$app.up" 2>&1; then
    cat "$D/$app.up"
    jq -r 'select(.type == "version-upload") | .version_id // empty' "$D/$app.ndjson" | tail -1 > "$D/$app.vid"
    # No id read: the full deploy at flip time, never a dead flip.
    [ -s "$D/$app.vid" ] || echo full > "$D/$app.vid"
  elif grep -qi migration "$D/$app.up"; then
    cat "$D/$app.up"; echo full > "$D/$app.vid"
  else
    cat "$D/$app.up"; return 1
  fi
}

cf_flip() {
  app=$1 sec=${2:-} vid=$(cat "$D/$1.vid")
  cd "apps/$app" || return 1
  if [ "$vid" = full ]; then
    npx wrangler deploy ${sec:+--secrets-file "$sec"}
  else
    npx wrangler versions deploy "$vid@100" -y --message "${GITHUB_SHA:0:12}" || return 1
    # Routes change only with wrangler.toml; traffic has already moved, so a miss only warns.
    npx wrangler triggers deploy || echo "::warning::$app: triggers deploy failed; routes unchanged"
  fi
}
