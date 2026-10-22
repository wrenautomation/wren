#!/bin/sh
# Push one commit to main, then wait for CI's gates and the deploy. Last line: "RESULT <sha> ci=<c> deploy=<d>".
#   scripts/push.sh <commit>    the commit must contain origin/main (cherry-pick onto it first)
# CI is the judge: no local copy of its checks (2026-10-22: they ran twice and doubled the wait).
# Check what you changed while you build (`gates.sh changed` or `ui`); CI runs the rest once.
# Only the main session pushes, one push at a time; builders commit and say ready.
set -eu
W=${WREN_PUSH_DIR:-$HOME/worktrees/wren-push}

sha=$(git rev-parse --verify "${1:?usage: scripts/push.sh <commit>}^{commit}")
[ -d "$W" ] || git worktree add -q --detach "$W" origin/main
cd "$W"
git fetch -q origin
git merge-base --is-ancestor origin/main "$sha" ||
  { echo "$sha does not contain origin/main: cherry-pick it onto origin/main first" >&2; exit 1; }

# GitHub's 500s come in outages: wait for Actions and Git to be up, then push (3 tries).
up() {
  curl -s https://www.githubstatus.com/api/v2/components.json | python3 -c "import json,sys
c={x['name']:x['status'] for x in json.load(sys.stdin)['components']}
sys.exit(0 if c.get('Actions')=='operational' and c.get('Git Operations')=='operational' else 1)"
}
until up; do echo "waiting for GitHub"; sleep 120; done
# The pre-push hook (.githooks: biome, cached typecheck) needs this commit's packages installed.
# The pusher worktree is outside Documents (VS Code) and other sessions' unsaved work.
git checkout -q --detach "$sha"
lock=$(git rev-parse HEAD:pnpm-lock.yaml) seen="$(git rev-parse --git-dir)/push-installed"
[ "$lock" = "$(cat "$seen" 2>/dev/null)" ] ||
  { pnpm install --frozen-lockfile --prefer-offline --reporter=silent && echo "$lock" > "$seen"; }
# The given commit, never a local ref: other sessions commit to main meanwhile.
for try in 1 2 3; do git push -q origin "$sha:main" && break; [ $try = 3 ] && exit 1; sleep 30; done
echo "pushed $sha"

# The ci run for this sha (deploy is its last job).
for _ in $(seq 1 40); do
  run=$(gh run list -w ci -b main -L 10 --json databaseId,headSha \
    -q "[.[] | select(.headSha == \"$sha\")] | max_by(.databaseId) | .databaseId // empty" 2>/dev/null) || run=
  [ -n "$run" ] && break
  sleep 5
done
[ -n "$run" ] || { echo "RESULT $sha ci=missing deploy=none"; exit 1; }
echo "ci run $run"

# The gates' joint conclusion and the deploy job's, once both are known; API errors retry.
# A red gate skips the deploy; a newer push cancels this run's gates (ci=cancelled).
while :; do
  st=$(gh run view "$run" --json jobs -q '[.jobs[] | {n: .name, s: .status, c: .conclusion}]' 2>/dev/null) || { sleep 10; continue; }
  out=$(printf '%s' "$st" | python3 -c "import json,sys
j=json.load(sys.stdin)
g=[x for x in j if x['n'] in ('lint','unit','schema')]
d=[x for x in j if x['n'].startswith('deploy')]
ci='pending' if len(g)<3 or any(x['s']!='completed' for x in g) else next((x['c'] for x in g if x['c']!='success'),'success')
dep=d[0]['c'] if d and d[0]['s']=='completed' else ('none' if ci not in ('pending','success') else 'pending')
print(ci, dep or 'pending')")
  set -- $out
  [ "$1" = pending ] || [ "$2" = pending ] || break
  sleep 10
done
echo "RESULT $sha ci=$1 deploy=$2"
[ "$2" = success ]
