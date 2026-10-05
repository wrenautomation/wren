#!/usr/bin/env bash
# Quality gates. Every command in a function is chained with && because bash
# suspends `set -e` inside functions called from an && list.
set -euo pipefail
cd "$(dirname "$0")/.."
lint() { echo "==> biome check" && pnpm biome check . && echo "==> typecheck" && pnpm turbo run typecheck && cli && offers && map && isolation; }
map() { echo "==> map" && map/_meta/build.sh --check; }
# Every transaction names its level through @wren/db's atomic/snapshot/serializable
# (designs/2026-10-04-postgres-isolation.md); a bare .transaction( outside packages/db fails.
isolation() {
  echo "==> isolation levels" &&
    ! git grep --untracked -n '\.transaction(' -- 'packages/*.ts' 'packages/*.tsx' 'apps/*.ts' 'apps/*.tsx' \
      ':!packages/db/*' ':!*/test/*' ':!*.test.ts' ':!*.test.tsx'
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
unit() { echo "==> unit tests" && pnpm turbo run test:unit; }
# Every integration file starts its own Postgres and migrates it. Vitest's default (cpus - 1 files at once)
# times 3 packages put ~27 containers on the Docker VM together, and setup hooks timed out at 180 s.
integration() { echo "==> integration tests (needs Docker)" && pnpm turbo run test:integration --concurrency=3 -- --maxWorkers=3; }
case "${1:-all}" in
  lint) lint ;;
  unit) unit ;;
  integration) integration ;;
  all) lint && unit && integration && echo "==> all gates green" ;;
  *) echo "usage: $0 [lint|unit|integration|all]" >&2; exit 2 ;;
esac
