#!/usr/bin/env bash
# Quality gates. Every command in a function is chained with && because bash
# suspends `set -e` inside functions called from an && list.
set -euo pipefail
cd "$(dirname "$0")/.."
# On the Mac, every worktree's gate runs one at a time, and all share one turbo cache.
# Four worktrees each running 10 tsc at once filled 16 GB and the OOM killer took a push (10-16).
# The lock is the queue: a second run waits for the first. The shared cache means a package
# whose inputs one worktree already checked is a cache hit in every other one.
# CI has a runner to itself, so it skips the lock and takes its cores back.
# The cache lives outside the repo: inside .git, each write made the editor's git view rescan
# every worktree while a gate ran (10-17).
if [ -z "${CI:-}" ]; then
  export TURBO_CACHE_DIR="${TURBO_CACHE_DIR:-$HOME/Library/Caches/wren_automation/turbo/wren}"
  LOCK=/tmp/wren_automation-checks.lock
  if [ -z "${CHECKS_LOCKED:-}" ]; then
    lockf -s -t 0 "$LOCK" true || echo "==> waiting for another gate run to finish"
    CHECKS_LOCKED=1 exec lockf -s "$LOCK" "$0" "$@"
  fi
fi
# vitest gives each project a temp dir (tmpdir()/<nanoid>) and removes it only on a clean close.
# Killed and OOM-stopped runs left 6217 of them in /private/tmp, 20.6 GB (10-14 to 10-23).
# Each run gets a fresh TMPDIR next to the turbo cache, wiped under the lock, so leaks last one run.
if [ -z "${CI:-}" ] && [ -z "${CHECKS_TMP:-}" ]; then
  export CHECKS_TMP=1 TMPDIR="$HOME/Library/Caches/wren_automation/tmp/wren"
  rm -rf "$TMPDIR" && mkdir -p "$TMPDIR"
fi
WIDE=${CI:+--concurrency=100%}
lint() {
  echo "==> biome check" && pnpm biome check --error-on-warnings . && echo "==> typecheck" && pnpm turbo run typecheck $WIDE &&
    cli && offers && map && layers && isolation && writes && sends && edits && reads && libs && drift && exports && size
}
# File size (designs/2026-10-24-code-quality-handoff.md): no source file over 1200 lines, a tripwire for
# a file an agent can no longer take in at once. scripts/big-files.txt lists the ones still over it,
# to split, and only shrinks: a new one fails, and one split below the line leaves the list.
size() {
  echo "==> file size" &&
    git ls-files '*.ts' '*.tsx' '*.mjs' '*.py' '*.sh' | grep -v '/drizzle/\|\.test\.\|\.stories\.' |
      xargs wc -l | awk '$1 > 1200 && $2 != "total" { print $2 }' | sort |
      diff <(sort scripts/big-files.txt) - ||
    { echo "files over 1200 lines differ from scripts/big-files.txt (< listed, > new): split it, or shorten the list" >&2; return 1; }
}
# Package layers (designs/2026-10-24-code-quality-handoff.md): a package imports its own layer or a
# lower one, never a cycle. Biome's noRestrictedImports checks single imports; this checks the graph.
layers() { echo "==> package layers" && node scripts/layers-guard.mjs; }
# Exports (designs/2026-10-24-code-quality-handoff.md, round 2): an export another file reads, or no
# `export`; one nothing reads is deleted. The module's export list is its interface.
exports() { echo "==> exports" && node scripts/exports-guard.mjs; }
map() { echo "==> map" && map/_meta/build.sh --check && scorecard; }
# Scorecards (map/_meta/scorecard.mjs): each package and Restate service graded on map card, tests,
# health and owner card; the worst rows print. Informational: it fails only with WREN_SCORECARD_MIN
# set (a grade, e.g. C), which makes any row below it fail.
scorecard() {
  echo "==> scorecard${WREN_SCORECARD_MIN:+ (min $WREN_SCORECARD_MIN)}" &&
    { map/_meta/build.sh --scorecard --top=10 ${WREN_SCORECARD_MIN:+--min="$WREN_SCORECARD_MIN"} ||
      [ -z "${WREN_SCORECARD_MIN:-}" ]; }
}
# Each Storybook's build, `@wren/ui`'s and the portal's pages (designs/2026-10-17-storybook-visual-tests.md,
# 2026-10-18-portal-page-stories.md). Not in lint (10-22): the story tests compile every story, and the
# portal's build (44 MB) is over the remote cache's 6 MB body cap, so lint rebuilt it every run.
stories() { echo "==> stories build" && pnpm turbo run stories:build --concurrency=1 --output-logs=errors-only; }
# Every story as a test: it renders, its play runs, axe checks it (light at 390, dark at 1280).
# One package at a time: each starts a Chromium, and the Mac holds one.
visual() { echo "==> story tests" && pnpm turbo run test:stories --concurrency=1 --output-logs=errors-only; }
# Every page story laid out on messy, prod-like data, as text (designs/2026-10-21-dev-loop.md): words
# over words, words past their box, a pane that scrolls sideways. Runs on the built portal Storybook.
look() {
  echo "==> page layout, messy data" &&
    pnpm turbo run stories:build --filter=@wren/portal --output-logs=errors-only &&
    (cd apps/portal && pnpm -s exec wren-look --all --static storybook-static --messy)
}
# Parts against the artifacts, as computed styles (designs/2026-10-21-artifact-match.md). Part of ui.
match() {
  echo "==> artifact match" &&
    pnpm turbo run stories:build --filter=@wren/ui --output-logs=errors-only &&
    (cd packages/ui && node .storybook/match.mjs --static storybook-static)
}
# Every transaction names its level through @wren/db's atomic/snapshot/serializable
# (designs/2026-10-04-postgres-isolation.md); a bare .transaction( outside packages/db fails.
# The local copy's IndexedDB transactions (packages/ui/src/data/local.ts) aren't Postgres.
isolation() {
  echo "==> isolation levels" &&
    ! git grep --untracked -n '\.transaction(' -- 'packages/*.ts' 'packages/*.tsx' 'apps/*.ts' 'apps/*.tsx' \
      ':!packages/db/*' ':!*/test/*' ':!*.test.ts' ':!*.test.tsx' ':!packages/ui/src/data/local.ts'
}
# Every portal write goes through `WRITES` (designs/2026-10-15-one-write-path.md). The web's one
# door to /api is api.ts's `call`, which sends each write through it; a raw fetch to /api elsewhere
# fails here (dictation posts audio, not a write), and so does a record action that skips `callOnce`.
writes() {
  echo "==> one write path" &&
    ! git grep --untracked -nE "fetch\([^)]*[\`'\"]/api/" -- 'apps/portal/web/src' 'packages/ui/src' \
      ':!apps/portal/web/src/api.ts' ':!apps/portal/web/src/dictation/server.ts' ':!*.test.ts' ':!*.test.tsx' &&
    ! git grep --untracked -nE "acts\.call\(|deps\.call\(" -- 'packages/ui/src' ':!*.test.ts' ':!*.test.tsx'
}
# Every handler the portal calls whose form says `effect: "sends"` is accept-then-track (SEND_HANDLERS).
sends() { echo "==> portal sends" && node scripts/sends-guard.mjs; }
# Every text box keeps its unsaved words in the one edits store (useEdit, useSaved, useKeptForm),
# or says why not with `edit-ok: <reason>`.
edits() { echo "==> unsaved edits" && node scripts/edits-guard.mjs; }
# Every portal read goes through the data layer (useCall/useLoad, readCall, recordsApi), so it is
# kept on the device and read again on return (designs/2026-10-15-one-write-path.md).
reads() { echo "==> portal reads" && node scripts/reads-guard.mjs; }
# The portal's routing, tables and forms stay on TanStack Router, TanStack Table and React Hook
# Form (designs/2026-10-16-portal-libs.md).
libs() { echo "==> portal libraries" && node scripts/libs-guard.mjs; }
# Drizzle's schema matches the migrations: generating into a copy of drizzle/ makes nothing new.
# A schema.ts change shipped without `pnpm db:generate` breaks its inserts on prod (0224).
drift() {
  echo "==> schema drift" &&
    tmp=$(cd packages/db && mktemp -d .drift.XXXXXX) && cp -R packages/db/drizzle/. "packages/db/$tmp" &&
    (cd packages/db && WREN_DRIFT_OUT="./$tmp" pnpm -s drizzle-kit generate --config drizzle.drift.config.ts >/dev/null) &&
    made=$(comm -13 <(ls packages/db/drizzle | sort) <(ls "packages/db/$tmp" | sort)) &&
    rm -rf "packages/db/${tmp:?}" &&
    { [ -z "$made" ] || { echo "schema changed without a migration ($made): run pnpm db:generate"; false; }; }
}
# The CLI ships as one esbuild bundle (bin/wren); a bundle that won't parse is caught here, not at first use.
cli() { echo "==> cli bundle" && pnpm --filter @wren/cli build; }
# The lander builds from a snapshot of the offer registry. Checked when the lander sits beside
# this repo (a laptop), skipped where it doesn't (CI checks out wren alone).
LANDER_OFFERS=../lander/src/data/offers.json
offers() {
  if [ -d ../lander ]; then echo "==> offers snapshot" && pnpm -s offers:export "$LANDER_OFFERS" --check;
  else echo "==> offers snapshot: no ../lander, skipped"; fi
}
unit() { echo "==> unit tests" && pnpm turbo run test:unit $WIDE; }
# One Postgres per package run, not per file (packages/db/src/testing-global-setup.ts): it migrates a
# template once, and each file clones it in about half a second. About 50 files change what a whole
# server shares (logins, client databases, settings) and keep a Postgres of their own: `{ own: true }`.
# Two knobs. Turbo runs PACKAGES packages at once; vitest runs FILES test files at once in each.
# The work is CPU, not memory: a full run peaks near 5 GB, with 10 cores and an 8 GB Docker VM on the
# Mac. 3 x 3 took 6.3 to 7.7 min, 3 x 4 took 7.9 to 8.8, and 4 x 4 failed (Restate could not register).
# CI has 4 cores and 16 GB. One job at 2 x 3 took 10 min cold, so CI splits the files into 8 shards
# (ci.yml): WREN_SHARD=i/n runs every package's i-th part, `vitest --shard`. With 8 shards,
# 3 x 3 took 4.7 min cold (2 x 3: 5.4; 12 shards at 2 x 3: 4.8). The shard is a turbo argument, so
# each shard caches on its own.
# WREN_IT_PACKAGES and WREN_IT_FILES override both knobs, to tune.
# A failed test retries once: a flake costs a rerun, not a red run. In CI a red package does not stop
# the rest (--continue): every package that passes goes into the cache, so the next run skips it.
integration() {
  echo "==> integration tests (needs Docker)" &&
    pnpm turbo run test:integration --concurrency="${WREN_IT_PACKAGES:-3}" ${CI:+--continue} \
      -- --maxWorkers="${WREN_IT_FILES:-3}" --retry=1 ${WREN_SHARD:+--shard="$WREN_SHARD" --passWithNoTests}
}
# The deploy gate's database checks: drizzle's schema matches the migrations, and the legacy email tables still read.
# A turbo task: when neither package nor anything it imports changed, a cache hit.
schema() {
  echo "==> schema (needs Docker)" &&
    pnpm turbo run test:schema --output-logs=errors-only
}
# The spam score is no gate: Wren ships no email copy (10-23), so the repo has no template to score.
# `wren email spamcheck` scores the live copy against the database (designs/2026-10-05-deliverability-tests.md).
# A builder's loop: Biome on the files changed since origin/main, then typecheck for the packages
# changed and what depends on them. No tests during the redesign (WA-917): `vitest run <file>`. The full gate runs once, at hand-off;
# unchanged packages are cache hits there.
changed() {
  echo "==> biome, changed since origin/main" &&
    pnpm -s biome check --error-on-warnings --changed --since=origin/main --no-errors-on-unmatched &&
    echo "==> typecheck, changed since origin/main" &&
    pnpm turbo run typecheck --filter="...[origin/main]" --output-logs=errors-only
}
# UI-only work: Biome on the files changed since origin/main (and not yet committed), typecheck of
# @wren/ui and @wren/portal only, the portal's source guards, and the artifact match. No tests
# during the redesign (WA-917): `visual` and `look` run on their own when you want them.
ui() {
  local files
  files=$({ git diff --name-only origin/main...HEAD && git diff --name-only HEAD && git ls-files --others --exclude-standard; } | sort -u | while read -r f; do [ -f "$f" ] && echo "$f"; done) &&
    echo "==> biome, changed files" &&
    { [ -z "$files" ] || pnpm -s biome check --no-errors-on-unmatched --files-ignore-unknown=true $files; } &&
    echo "==> typecheck @wren/ui @wren/portal" &&
    pnpm turbo run typecheck --filter=@wren/ui --filter=@wren/portal --output-logs=errors-only &&
    writes && sends && edits && reads && libs && match
}
case "${1:-all}" in
  lint) lint ;;
  changed) changed ;;
  ui) ui ;;
  unit) unit ;;
  stories) stories ;;
  visual) visual ;;
  look) look ;;
  match) match ;;
  integration) integration ;;
  schema) schema ;;
  drift) drift ;;
  scorecard) scorecard ;;
  # lint's source checks without biome and the full typecheck (the push script runs those its own way).
  checks) cli && offers && map && layers && isolation && writes && edits && reads && libs && drift && exports && size ;;
  all) lint && unit && visual && schema && integration && echo "==> all gates green" ;;
  *) echo "usage: $0 [lint|changed|ui|checks|unit|stories|visual|look|match|schema|drift|scorecard|integration|all]" >&2; exit 2 ;;
esac
