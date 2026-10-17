#!/bin/sh
# Push one commit to main, then wait for CI and the deploy. Last line: "RESULT <sha> ci=<c> deploy=<d>".
#   scripts/push.sh <commit>    the commit must contain origin/main (cherry-pick onto it first)
# The checks run in a worktree of their own (WREN_PUSH_DIR, default ~/worktrees/wren-push): other
# sessions keep uncommitted work in the main checkout, and the checks read the working tree.
# Only the main session pushes, one push at a time; builders commit and say ready.
set -eu
L=/tmp/wren_automation-checks.lock
W=${WREN_PUSH_DIR:-$HOME/worktrees/wren-push}

# Typecheck, unit and lint for what changed, as CI runs them, under the Mac's one checks lock.
check() {
  cd "$W"
  git checkout -q --detach "$1"
  # Install when the lockfile differs from the last one installed here.
  lock=$(git rev-parse HEAD:pnpm-lock.yaml) seen="$(git rev-parse --git-dir)/push-installed"
  [ "$lock" = "$(cat "$seen" 2>/dev/null)" ] ||
    { pnpm install --frozen-lockfile --prefer-offline --reporter=silent && echo "$lock" > "$seen"; }
  ./scripts/gates.sh checks
  pnpm -s biome check --diagnostic-level=error .
  ./scripts/gates.sh changed
  # A migration or schema change: CI's schema tests (Docker).
  git diff --quiet origin/main HEAD -- packages/db/drizzle packages/core/src/schema.ts || ./scripts/gates.sh schema
}

if [ "${1:-}" = --check ]; then check "$2"; exit; fi

sha=$(git rev-parse --verify "${1:?usage: scripts/push.sh <commit>}^{commit}")
[ -d "$W" ] || git worktree add -q --detach "$W" origin/main
git -C "$W" fetch -q origin
git merge-base --is-ancestor origin/main "$sha" ||
  { echo "$sha does not contain origin/main: cherry-pick it onto origin/main first" >&2; exit 1; }
CHECKS_LOCKED=1 lockf -s "$L" sh "$0" --check "$sha"

# GitHub's 500s come in outages: wait for Actions and Git to be up, then push (3 tries).
up() {
  curl -s https://www.githubstatus.com/api/v2/components.json | python3 -c "import json,sys
c={x['name']:x['status'] for x in json.load(sys.stdin)['components']}
sys.exit(0 if c.get('Actions')=='operational' and c.get('Git Operations')=='operational' else 1)"
}
until up; do echo "waiting for GitHub"; sleep 120; done
# The checked commit, never the main ref: other sessions commit to main while checks run.
for try in 1 2 3; do git -C "$W" push -q origin "$sha:main" && break; [ $try = 3 ] && exit 1; sleep 60; done
echo "pushed $sha"

# A run's conclusion once it completes; GitHub API errors retry instead of reading as a result.
done_of() {
  while :; do
    st=$(gh run view "$1" --json status,conclusion -q '.status+" "+.conclusion' 2>/dev/null) || st=
    case "$st" in "completed "?*) echo "${st#completed }"; return ;; esac
    sleep 20
  done
}
# The newest run of a workflow for this sha, past an earlier run id; skipped deploys don't count.
run_of() {
  for _ in $(seq 1 60); do
    id=$(gh run list -w "$1" -L 10 --json databaseId,headSha,conclusion \
      -q "[.[] | select(.headSha == \"$sha\") | select(.conclusion != \"skipped\") | select(.databaseId > $2)] | max_by(.databaseId) | .databaseId // empty" 2>/dev/null) || id=
    [ -n "$id" ] && { echo "$id"; return; }
    sleep 15
  done
}
cd "$W"
ci=$(run_of ci 0)
[ -n "$ci" ] || { echo "RESULT $sha ci=missing deploy=none"; exit 1; }
cc=$(done_of "$ci")
[ "$cc" = success ] || { echo "RESULT $sha ci=$cc deploy=none"; exit 1; }
d=$(run_of deploy "$ci")
[ -n "$d" ] || { echo "RESULT $sha ci=$cc deploy=missing"; exit 1; }
dc=$(done_of "$d")
echo "RESULT $sha ci=$cc deploy=$dc"
[ "$dc" = success ]
