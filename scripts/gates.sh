#!/usr/bin/env bash
# Quality gates. Every command in a function is chained with && because bash
# suspends `set -e` inside functions called from an && list.
set -euo pipefail
cd "$(dirname "$0")/.."
lint() { echo "==> biome check" && pnpm biome check . && echo "==> typecheck" && pnpm turbo run typecheck; }
unit() { echo "==> unit tests" && pnpm turbo run test:unit; }
integration() { echo "==> integration tests (needs Docker)" && pnpm turbo run test:integration; }
case "${1:-all}" in
  lint) lint ;;
  unit) unit ;;
  integration) integration ;;
  all) lint && unit && integration && echo "==> all gates green" ;;
  *) echo "usage: $0 [lint|unit|integration|all]" >&2; exit 2 ;;
esac
