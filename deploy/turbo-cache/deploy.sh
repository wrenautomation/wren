#!/usr/bin/env bash
# Build the remote cache's Lambda and replace its code. Terraform (turbo-cache.tf) made the function.
# Usage: deploy/turbo-cache/deploy.sh   (AWS session of an admin; region us-east-1)
set -euo pipefail
cd "$(dirname "$0")"
pnpm install --ignore-workspace --frozen-lockfile --silent
node build.mjs
aws lambda update-function-code --region us-east-1 --function-name wren-prod-turbo-cache \
  --zip-file fileb://dist/lambda.zip --query LastUpdateStatus --output text
aws lambda wait function-updated-v2 --region us-east-1 --function-name wren-prod-turbo-cache
echo "turbo cache code updated"
