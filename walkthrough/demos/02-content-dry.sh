#!/bin/bash
# One idea through the LOCAL stack: add → drafts → show → reject. Needs docker compose up, pnpm worker,
# pnpm register, and a real model (WREN_LLM != fake, keys in llm.env). Nothing is approved or posted.
set -euo pipefail
cd "$(dirname "$0")/../.."
LLM=$(grep '^WREN_LLM=' .env | cut -d= -f2-); LLM=${WREN_LLM:-${LLM:-fake}}
[ "$LLM" != fake ] || { echo "WREN_LLM is fake: set a provider in .env (walkthrough/00-setup.md, Models)"; exit 1; }
echo "== add an idea (drafts for linkedin and x)"
OUT=$(echo "shipped the spend gate today. every buy asks me first, over the phone, with the amount." \
  | pnpm -s wren content add --platforms linkedin,x)
echo "$OUT"
echo
echo "== drafts"
pnpm -s wren content drafts
echo
ID=$(pnpm -s wren content drafts | awk 'NR==1{print $1}')
[ -n "$ID" ] && { echo "== show $ID"; pnpm -s wren content show "$ID"; echo; echo "== reject it (demo)"; pnpm -s wren content reject "$ID"; }
