# Helpers for deploy/scripts/deploy.sh. One shell: the runner ends a step's background work
# with the step (10-22: work started in one step never finished in the next).
#   bg <name> <cmd...>     run in the background; log and exit code in $RUNNER_TEMP/bg
#   await <name...>        wait for each (10 min cap), print its log, fail if any failed or ran out
#   ssm_run <comment> <file.json>   run a command doc on the box, print its output, fail unless Success
#   box_script <name> <script> [args...]   install deploy/scripts/<script> on the box as wren-box-<name> and run it
#   await_gates            wait for this run's lint, unit and schema jobs; fail unless all three pass
D="$RUNNER_TEMP/bg"
mkdir -p "$D"

# Every helper keeps its names local: a task runs inside bg's subshell and would rename its files.
bg() {
  local n=$1; shift
  # set +e: the step shell's -e would end the subshell before it writes the exit code.
  # Its own stdio off the step's pipes, or the runner waits for it before the step ends.
  ( set +e; "$@" > "$D/$n.log" 2>&1; echo $? > "$D/$n.rc" ) > /dev/null 2>&1 < /dev/null &
}

await() {
  local n t rc failed=
  for n in "$@"; do
    t=0
    while [ ! -s "$D/$n.rc" ] && [ $t -lt 600 ]; do sleep 1; t=$((t + 1)); done
    rc=$(cat "$D/$n.rc" 2>/dev/null || echo "none after ${t}s")
    echo "::group::$n (exit $rc)"; cat "$D/$n.log"; echo "::endgroup::"
    [ "$rc" = 0 ] || failed="$failed $n"
  done
  [ -z "$failed" ] || { echo "::error::failed:$failed"; return 1; }
}

# Polls each second: `aws ssm wait` polls every 5.
ssm_run() {
  local id out
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

# A newer push cancels this run's gates: cancelled fails here, and the newer run deploys.
await_gates() {
  local out
  while :; do
    out="$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/jobs?filter=latest" --jq '
      [.jobs[] | select(.name == "lint" or .name == "schema")]
      | if length < 2 or any(.status != "completed") then "wait"
        elif all(.conclusion == "success") then "pass"
        else "fail " + ([.[] | select(.conclusion != "success") | .name + "=" + .conclusion] | join(" ")) end')" || out=wait
    case "$out" in
      pass) return 0 ;;
      fail*) echo "::error::gates: ${out#fail }"; return 1 ;;
    esac
    sleep 2
  done
}

box_script() {
  local n=$1 s=$2 b; shift 2
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
  local app=$1 sec=${2:-}
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

# A Worker no prod path needs: its failure is a warning, never a failed deploy.
cf_soft() {
  "$@" || echo "::warning::$*: failed; deploy it by hand (npx wrangler deploy in apps/$2)"
}

cf_flip() {
  local app=$1 sec=${2:-} vid
  vid=$(cat "$D/$1.vid")
  cd "apps/$app" || return 1
  if [ "$vid" = full ]; then
    npx wrangler deploy ${sec:+--secrets-file "$sec"}
  else
    npx wrangler versions deploy "$vid@100" -y --message "${GITHUB_SHA:0:12}" || return 1
    # Routes change only with wrangler.toml; traffic has already moved, so a miss only warns.
    npx wrangler triggers deploy || echo "::warning::$app: triggers deploy failed; routes unchanged"
  fi
}
