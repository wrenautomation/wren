#!/usr/bin/env bash
# Quality gates. Every command in a function is chained with && because bash
# suspends `set -e` inside functions called from an && list.
set -euo pipefail
cd "$(dirname "$0")/.."
lint() { echo "==> biome check" && pnpm biome check . && echo "==> typecheck" && pnpm turbo run typecheck && offers; }
# The lander builds from a snapshot of the offer registry. Checked when the lander sits beside
# this repo (a laptop), skipped where it doesn't (CI checks out wren alone).
LANDER_OFFERS=../lander/src/data/offers.json
offers() {
  if [ -d ../lander ]; then echo "==> offers snapshot" && pnpm -s offers:export "$LANDER_OFFERS" --check;
  else echo "==> offers snapshot: no ../lander, skipped"; fi
}
unit() { echo "==> unit tests" && pnpm turbo run test:unit; }
integration() { echo "==> integration tests (needs Docker)" && pnpm turbo run test:integration; }
case "${1:-all}" in
  lint) lint ;;
  unit) unit ;;
  integration) integration ;;
  all) lint && unit && integration && echo "==> all gates green" ;;
  *) echo "usage: $0 [lint|unit|integration|all]" >&2; exit 2 ;;
esac
