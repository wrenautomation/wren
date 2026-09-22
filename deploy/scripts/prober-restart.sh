#!/bin/bash
# Runs ON the Postgres box: pull the prober bundle from S3 and (re)start its container.
# Installed by user-data on first boot and by deploy/scripts/deploy-prober.sh after each
# build. Env: REGION, BUCKET, TOKEN_PARAM (SSM name), HELO.
set -euo pipefail
: "${REGION:?}" "${BUCKET:?}" "${TOKEN_PARAM:?}" "${HELO:?}"
mkdir -p /var/lib/wren-pg/prober
aws s3 cp --region "$REGION" "s3://$BUCKET/prober/prober.mjs" /var/lib/wren-pg/prober/prober.mjs
TOKEN="$(aws ssm get-parameter --region "$REGION" --name "$TOKEN_PARAM" --with-decryption \
  --query Parameter.Value --output text)"
docker rm -f wren-prober >/dev/null 2>&1 || true
docker run -d --name wren-prober --restart unless-stopped \
  -p 2525:2525 -e PROBE_PORT=2525 -e PROBE_HELO="$HELO" -e PROBE_TOKEN="$TOKEN" \
  -v /var/lib/wren-pg/prober:/app:ro \
  public.ecr.aws/docker/library/node:22-alpine node /app/prober.mjs
unset TOKEN
echo "wren-prober started as $HELO"
