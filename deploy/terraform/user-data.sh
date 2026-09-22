#!/bin/bash
# First boot of the Postgres box (Amazon Linux 2023, ARM). Idempotent: a reboot
# re-runs nothing here (cloud-init runs user-data once), a rebuilt instance
# finds the data volume already initialised and mounts it as is.
set -euxo pipefail
exec > >(tee /var/log/wren-user-data.log) 2>&1

dnf install -y docker cronie
systemctl enable --now docker crond

# The data volume, by id so the device name never matters.
DEV="/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${volume_id}"
DEV="$${DEV/vol-/vol}"
until [ -e "$DEV" ]; do sleep 2; done
blkid "$DEV" >/dev/null 2>&1 || mkfs.ext4 -L wrenpg "$DEV"
mkdir -p /var/lib/wren-pg
grep -q wrenpg /etc/fstab || echo "LABEL=wrenpg /var/lib/wren-pg ext4 defaults,nofail 0 2" >> /etc/fstab
mountpoint -q /var/lib/wren-pg || mount /var/lib/wren-pg

# A self-signed cert, kept on the volume so a rebuilt instance presents the same one.
TLS=/var/lib/wren-pg/tls
mkdir -p "$TLS" /var/lib/wren-pg/data
if [ ! -f "$TLS/server.crt" ]; then
  openssl req -new -x509 -days 3650 -nodes -subj "/CN=${db_name}-pg" \
    -out "$TLS/server.crt" -keyout "$TLS/server.key"
fi
chown -R 999:999 "$TLS"
chmod 600 "$TLS/server.key"

# TLS only from outside; the socket inside the container stays open for exec/backups.
cat > "$TLS/pg_hba.conf" <<'HBA'
local     all all             trust
host      all all 127.0.0.1/32 scram-sha-256
hostssl   all all 0.0.0.0/0    scram-sha-256
hostssl   all all ::/0         scram-sha-256
hostnossl all all 0.0.0.0/0    reject
HBA
chown 999:999 "$TLS/pg_hba.conf"

PW="$(aws ssm get-parameter --region "${region}" --name "${pw_param}" --with-decryption \
  --query Parameter.Value --output text)"

docker rm -f wren-pg >/dev/null 2>&1 || true
docker run -d --name wren-pg --restart unless-stopped \
  -p 5432:5432 \
  -e POSTGRES_USER="${db_user}" -e POSTGRES_PASSWORD="$PW" -e POSTGRES_DB="${db_name}" \
  -e POSTGRES_INITDB_ARGS="--auth-host=scram-sha-256 --auth-local=trust" \
  -v /var/lib/wren-pg/data:/var/lib/postgresql/data \
  -v "$TLS":/tls:ro \
  ${pg_image} \
  -c ssl=on -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/tls/server.key \
  -c hba_file=/tls/pg_hba.conf -c password_encryption=scram-sha-256 \
  -c shared_buffers=256MB -c max_connections=60
unset PW

# The render tier: browserless chromium, token-gated, when a token was provisioned.
if [ -n "${browser_token_param}" ]; then
  TOKEN="$(aws ssm get-parameter --region "${region}" --name "${browser_token_param}" --with-decryption \
    --query Parameter.Value --output text)"
  docker rm -f wren-browser >/dev/null 2>&1 || true
  docker run -d --name wren-browser --restart unless-stopped \
    -p 3000:3000 -e TOKEN="$TOKEN" -e CONCURRENT=2 -e TIMEOUT=60000 \
    --shm-size=512m ghcr.io/browserless/chromium:latest
  unset TOKEN
fi

# The SMTP prober (the mailifier package): bundle and restart script live in S3 under
# prober/ (deploy/scripts/deploy-prober.sh puts them there and re-runs the script).
if [ -n "${probe_token_param}" ]; then
  if aws s3 cp --region ${region} "s3://${backups}/prober/restart.sh" /usr/local/bin/wren-prober-restart; then
    chmod +x /usr/local/bin/wren-prober-restart
    REGION=${region} BUCKET=${backups} TOKEN_PARAM=${probe_token_param} HELO=${probe_helo} \
      /usr/local/bin/wren-prober-restart || echo "prober not started"
  else
    echo "no prober in S3 yet; run deploy/scripts/deploy-prober.sh"
  fi
fi

# Nightly dump to S3; the bucket's lifecycle rule expires old ones.
cat > /usr/local/bin/wren-pg-backup <<'BK'
#!/bin/bash
set -euo pipefail
docker exec wren-pg pg_dump -U ${db_user} -Fc ${db_name} \
  | aws s3 cp --region ${region} - "s3://${backups}/pg/$(date -u +%F).dump"
BK
chmod +x /usr/local/bin/wren-pg-backup
echo "0 8 * * * root /usr/local/bin/wren-pg-backup >> /var/log/wren-pg-backup.log 2>&1" > /etc/cron.d/wren-pg-backup
