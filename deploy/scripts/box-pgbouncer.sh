#!/bin/bash
# Runs ON the Postgres box (CI sends it over SSM): PgBouncer in transaction mode on 6432, in
# front of Postgres on 5432. The worker (Lambda and box) connects here when
# WREN_DATABASE_POOL_PORT is set; the CLI and migrations stay on 5432, since they set session
# parameters. Same config and running: left alone. CI logs are public: never print the password.
set -euo pipefail
dir=/var/lib/wren-pg/pgbouncer
image=edoburu/pgbouncer:v1.25.2-p0

# Main's login, as Postgres was started with it. It is also auth_user: it reads every other
# login's SCRAM secret, so a client's role works the moment it exists.
user="$(docker exec wren-pg printenv POSTGRES_USER)"
db="$(docker exec wren-pg printenv POSTGRES_DB)"
pw="$(docker exec wren-pg printenv POSTGRES_PASSWORD)"

rm -rf "$dir.new" && mkdir -p "$dir.new"
cp /var/lib/wren-pg/tls/server.crt /var/lib/wren-pg/tls/server.key "$dir.new/"
printf '"%s" "%s"\n' "$user" "${pw//\"/\"\"}" > "$dir.new/userlist.txt"
unset pw
cat > "$dir.new/pgbouncer.ini" <<INI
[databases]
* = host=127.0.0.1 port=5432

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
pool_mode = transaction
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
auth_user = $user
auth_dbname = $db
auth_query = SELECT usename, passwd FROM pg_catalog.pg_shadow WHERE usename = \$1
client_tls_sslmode = require
client_tls_cert_file = /etc/pgbouncer/server.crt
client_tls_key_file = /etc/pgbouncer/server.key
server_tls_sslmode = require
; Postgres allows 60: 40 through here, the rest for the CLI, migrations and backups.
max_client_conn = 500
default_pool_size = 20
max_db_connections = 40
server_idle_timeout = 60
; A client gone mid-transaction (a Lambda timeout) frees its server connection in 10 min,
; as Postgres's own idle_in_transaction_session_timeout does (deploy/pg-settings.sql).
idle_transaction_timeout = 600
; createDb sends it; Postgres has it server-wide. wren.actor is left unknown on purpose: a
; pooled connection can't keep it, so asking for one fails instead of dropping the audit's who.
ignore_startup_parameters = extra_float_digits,idle_in_transaction_session_timeout
INI
chown -R 70:70 "$dir.new" && chmod 600 "$dir.new"/*

if [ -d "$dir" ] && diff -rq "$dir" "$dir.new" >/dev/null 2>&1 &&
  [ "$(docker inspect -f '{{.State.Running}}' wren-pgbouncer 2>/dev/null)" = true ]; then
  rm -rf "$dir.new"
  echo "pgbouncer unchanged, left running"
  exit 0
fi
rm -rf "$dir" && mv "$dir.new" "$dir"

# A restart drops pooled clients; postgres.js reconnects on its next query, Restate retries the rest.
docker rm -f wren-pgbouncer >/dev/null 2>&1 || true
docker run -d --name wren-pgbouncer --restart unless-stopped --network host --memory 64m \
  --log-opt max-size=10m --log-opt max-file=3 \
  -v "$dir":/etc/pgbouncer:ro --entrypoint /usr/bin/pgbouncer \
  "$image" /etc/pgbouncer/pgbouncer.ini >/dev/null

# Up = a TLS login through it reaches Postgres. From inside wren-pg, so no psql on the host.
gw="$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}')"
for _ in $(seq 1 10); do
  sleep 1
  if PGPASSWORD="$(docker exec wren-pg printenv POSTGRES_PASSWORD)" docker exec -e PGPASSWORD wren-pg \
    psql "host=$gw port=6432 dbname=$db user=$user sslmode=require" -Atc 'select 1' >/dev/null 2>&1; then
    echo "pgbouncer up on 6432"
    exit 0
  fi
done
# Lines name a database and a client IP (a client's database is its name): masked for CI.
docker logs --tail 20 wren-pgbouncer 2>&1 | sed -E 's#[^ ]+/[^ ]+@[0-9a-fA-F.:]+#<db>/<user>@<ip>#g'
exit 1
