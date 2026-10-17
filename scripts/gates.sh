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
WIDE=${CI:+--concurrency=100%}
lint() { echo "==> biome check" && pnpm biome check . && echo "==> typecheck" && pnpm turbo run typecheck $WIDE && stories && cli && offers && map && isolation && writes && edits && reads && libs && drift; }
map() { echo "==> map" && map/_meta/build.sh --check; }
# `@wren/ui`'s Ladle stories build (designs/2026-10-17-ui-workbench-and-fast-ci.md): a story that
# breaks fails here; an unchanged one is a turbo cache hit.
stories() { echo "==> ui stories" && pnpm turbo run stories:build $WIDE --output-logs=errors-only; }
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
# Every integration file starts its own Postgres and migrates it. Vitest's default (cpus - 1 files at once)
# times 3 packages put ~27 containers on the Docker VM together, and setup hooks timed out at 180 s.
# A failed test retries once: a flake costs a rerun, not a red run. In CI a red package does not stop
# the rest (--continue): every package that passes goes into the cache, so the next run skips it.
integration() { echo "==> integration tests (needs Docker)" && pnpm turbo run test:integration --concurrency=3 ${CI:+--continue} -- --maxWorkers=3 --retry=1 && spam; }
# The deploy gate's database checks: drizzle's schema matches the migrations, and the legacy email tables still read.
schema() {
  echo "==> schema (needs Docker)" &&
    (cd packages/db && pnpm -s vitest run test/integration/schema.test.ts) &&
    (cd packages/channel-email && pnpm -s vitest run test/integration/legacy-parity.test.ts)
}
# Every template option through SpamAssassin (designs/2026-10-05-deliverability-tests.md); one over 2.0 fails.
# The CLI wants a database URL at start; spamcheck reads none without --drafts, and CI has none.
spam() { echo "==> spam score (needs Docker)" && WREN_DATABASE_URL="${WREN_DATABASE_URL:-postgres://unused@127.0.0.1:1/unused}" ./bin/wren email spamcheck; }
# A builder's loop: Biome on the files changed since origin/main, then typecheck and unit tests
# for the packages changed and what depends on them. The full gate runs once, at hand-off;
# unchanged packages are cache hits there.
changed() {
  echo "==> biome, changed since origin/main" &&
    pnpm -s biome check --changed --since=origin/main --no-errors-on-unmatched &&
    echo "==> typecheck + unit, changed since origin/main" &&
    pnpm turbo run typecheck test:unit --filter="...[origin/main]" --output-logs=errors-only
}
# UI-only work: Biome on the files changed since origin/main (and not yet committed), typecheck of
# @wren/ui and @wren/portal only, the portal's source guards, and the unit tests that import a
# changed file (`vitest related`).
ui() {
  local files
  files=$({ git diff --name-only origin/main...HEAD && git diff --name-only HEAD && git ls-files --others --exclude-standard; } | sort -u | while read -r f; do [ -f "$f" ] && echo "$f"; done) &&
    echo "==> biome, changed files" &&
    { [ -z "$files" ] || pnpm -s biome check --no-errors-on-unmatched --files-ignore-unknown=true $files; } &&
    echo "==> typecheck @wren/ui @wren/portal" &&
    pnpm turbo run typecheck --filter=@wren/ui --filter=@wren/portal --output-logs=errors-only &&
    writes && edits && reads && libs &&
    echo "==> unit tests related to the changed files" &&
    related packages/ui "$files" && related apps/portal "$files"
}
# `vitest related` in one package, on its changed .ts/.tsx files; none changed, nothing runs.
related() {
  local own
  own=$(printf '%s\n' "$2" | sed -n "s|^$1/||p" | grep -E '\.tsx?$' || true)
  [ -z "$own" ] || (cd "$1" && pnpm -s exec vitest related --run --passWithNoTests $own)
}
case "${1:-all}" in
  lint) lint ;;
  changed) changed ;;
  ui) ui ;;
  unit) unit ;;
  integration) integration ;;
  schema) schema ;;
  drift) drift ;;
  # lint's source checks without biome and the full typecheck (the push script runs those its own way).
  checks) cli && offers && map && isolation && writes && edits && reads && libs && drift ;;
  all) lint && unit && schema && integration && echo "==> all gates green" ;;
  *) echo "usage: $0 [lint|changed|ui|checks|unit|schema|drift|integration|all]" >&2; exit 2 ;;
esac
