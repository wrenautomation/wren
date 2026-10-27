#!/bin/sh
# Push one commit to main, then wait for CI's gates and the deploy. Last line: "RESULT <sha> ci=<c> deploy=<d>".
#   scripts/push.sh <commit>
# CI is the judge: no local copy of its checks (2026-10-22: they ran twice and doubled the wait).
# Check what you changed while you build (`gates.sh changed` or `ui`); CI runs the rest once.
# Any session may push. Pushes take turns on a lock; the CI watch runs outside it.
# If origin/main moved past the commit, the push merges it in (a merge commit) and pushes that.
set -eu
W=${WREN_PUSH_DIR:-$HOME/worktrees/wren-push}
L=/tmp/wren_automation-push.lock

# --push <sha>: the part under the lock. Prints the pushed sha (the commit, or its merge with origin/main).
if [ "${1:-}" = --push ]; then
  sha=$2
  cd "$W"
  # Two sessions shared this worktree with no lock: one's checkout moved HEAD under the other's
  # pre-push typecheck (10-26 review). The lock makes the checkout, install and push one unit.
  fetch() { for _ in 1 2 3; do git fetch -q origin && return 0; sleep 10; done; return 1; }
  # A run killed mid-merge leaves the worktree dirty; the next one starts clean.
  git merge --abort 2>/dev/null || :
  for _ in 1 2 3 4 5; do
    fetch
    head=$sha
    if ! git merge-base --is-ancestor origin/main "$sha"; then
      # Another session pushed first. Merge, never rebase: the commit keeps its sha in every checkout.
      git checkout -q -f --detach "$sha"
      git merge -q --no-edit -m "Merge origin/main into $(git log -1 --format=%h "$sha")" origin/main >&2 ||
        { git merge --abort 2>/dev/null; echo "$sha conflicts with origin/main: merge it by hand" >&2; exit 1; }
      head=$(git rev-parse HEAD)
    fi
    # The pre-push hook (.githooks: biome, cached typecheck) needs this commit's packages installed.
    git checkout -q -f --detach "$head"
    lock=$(git rev-parse HEAD:pnpm-lock.yaml) seen="$(git rev-parse --git-dir)/push-installed"
    [ "$lock" = "$(cat "$seen" 2>/dev/null)" ] ||
      { pnpm install --frozen-lockfile --prefer-offline --reporter=silent >&2 && echo "$lock" > "$seen"; }
    # The given commit, never a local ref: other sessions commit to main meanwhile.
    if out=$(git push -q origin "$head:main" 2>&1); then
      echo "$head"
      exit 0
    fi
    echo "$out" >&2
    # A rejected push (origin moved) merges again; a network fault waits and tries again. Anything
    # else, such as a red pre-push hook, is the commit's to fix.
    case $out in
      *"[rejected]"* | *"fetch first"* | *"non-fast-forward"*) ;;
      *"Could not read from remote"* | *"Could not resolve host"* | *"RPC failed"* | *"early EOF"* | \
        *"Operation timed out"* | *"Connection reset"* | *"Connection refused"* | *"returned error: 5"*) sleep 20 ;;
      *) exit 1 ;;
    esac
  done
  echo "push failed 5 times" >&2
  exit 1
fi

sha=$(git rev-parse --verify "${1:?usage: scripts/push.sh <commit>}^{commit}")
C=$(git rev-parse --show-toplevel)
[ -d "$W" ] || { git fetch -q origin && git worktree add -q --detach "$W" origin/main; }

# GitHub's 500s come in outages: wait while Git is down, up to 30 min. A degraded Actions only
# delays CI. The status page itself can be down or lag: then go on. PUSH_NOW=1 skips the check.
up() {
  [ "${PUSH_NOW:-}" = 1 ] && return 0
  page=$(curl -fsS --max-time 15 https://www.githubstatus.com/api/v2/components.json 2>/dev/null) || return 0
  echo "$page" | python3 -c "import json,sys
c={x['name']:x['status'] for x in json.load(sys.stdin)['components']}
if c.get('Actions')!='operational': print('Actions is '+str(c.get('Actions'))+': CI may run late', file=sys.stderr)
sys.exit(0 if c.get('Git Operations')=='operational' else 3)" || [ $? -ne 3 ]
}
for _ in $(seq 1 15); do up && break; echo "waiting for GitHub Git Operations (PUSH_NOW=1 to skip)"; sleep 120; done

lockf -s -t 0 "$L" true || echo "==> waiting for another push to finish"
sha=$(lockf -s "$L" sh "$0" --push "$sha")
echo "pushed $sha"

# The ci run for this sha (deploy is its last job). A busy Actions can take minutes to start it.
for _ in $(seq 1 120); do
  run=$(gh run list -w ci -b main -L 20 --json databaseId,headSha \
    -q "[.[] | select(.headSha == \"$sha\")] | max_by(.databaseId) | .databaseId // empty" 2>/dev/null) || run=
  [ -n "$run" ] && break
  sleep 5
done
[ -n "$run" ] || { echo "pushed, but no ci run started in 10 min"; echo "RESULT $sha ci=missing deploy=none"; exit 1; }
echo "ci run $run"

# The gates' joint conclusion and the deploy job's, once both are known; API errors retry. The
# latest attempt's jobs only (a re-run's first attempt stays in the run as cancelled), and a
# failure outranks a cancel; neither is final while either gate still runs. Unit and integration
# report only during the redesign (WA-917, 10-27). A red gate stops the deploy before it changes
# anything (deploy=failure, "gates: ..." in its log); a newer push cancels this run's gates (ci=cancelled, deploy=failure).
# deploy/scripts/ci-steps.sh await_gates reads the same jobs the same way.
STATUS='[.jobs[] | select(.name == "lint" or .name == "schema")] as $g
  | ([.jobs[] | select(.name | startswith("deploy"))] | first) as $d
  | (if ($g | length) < 2 or any($g[]; .status != "completed") then "pending"
     elif any($g[]; .conclusion == "failure") then "failure"
     elif all($g[]; .conclusion == "success") then "success"
     else ($g | map(select(.conclusion != "success")) | first | .conclusion) end) as $ci
  | "\($ci) \(if $d and $d.status == "completed" then $d.conclusion
              elif $ci == "pending" or $ci == "success" then "pending" else "none" end)"'
# A run takes ~2 min; 40 min means a stuck runner or a lost network, not a slow gate.
end=$(($(date +%s) + 2400))
set -- timeout none
while [ "$(date +%s)" -lt "$end" ]; do
  out=$(gh api "repos/{owner}/{repo}/actions/runs/$run/jobs?filter=latest" --jq "$STATUS" 2>/dev/null) ||
    { sleep 10; continue; }
  set -- $out
  [ "$1" = pending ] || [ "$2" = pending ] || break
  sleep 5
done
[ "$1" = pending ] && set -- timeout "$2"
# The folder copy this ran from follows main (10-22: it fell 44 commits behind and ran an old
# push.sh). Its own commits stay (a merge); a conflict or a local edit in the way leaves it as is.
if [ "$(git -C "$C" symbolic-ref -q --short HEAD)" = main ]; then
  git -C "$C" fetch -q origin
  git -C "$C" merge -q --ff-only origin/main 2>/dev/null ||
    git -C "$C" merge -q --no-edit origin/main 2>/dev/null ||
    { git -C "$C" merge --abort 2>/dev/null; echo "$C: not synced with origin/main, merge it by hand" >&2; }
fi
echo "RESULT $sha ci=$1 deploy=$2"
[ "$2" = success ]
