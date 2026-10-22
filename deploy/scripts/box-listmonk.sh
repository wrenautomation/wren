#!/bin/bash
# Runs ON the Postgres box (CI sends it over SSM): Listmonk on 127.0.0.1:9000, the newsletter's lists,
# subscribers and campaigns (designs/2026-10-21-esign-and-newsletter.md). It keeps its own database
# and login on the box Postgres. It never sends mail: its postback messenger posts each message to
# the Restate ingress on loopback (settings: `wren listmonk setup`). Caddy serves it at
# lists.wrenautomation.com (box-restate.sh). Same config and running: left alone.
# CI logs are public: never print a password.
# Usage: box-listmonk.sh <region> [param]
# The param is SecureString JSON {"admin_user", "admin_password", "db_password"}. Missing: skipped.
set -euo pipefail
region="$1" param="${2:-/wren/prod/listmonk}"
D=/var/lib/wren-pg/listmonk
image=listmonk/listmonk:v6.2.0
name=wren-listmonk

if ! secrets="$(aws ssm get-parameter --region "$region" --name "$param" --with-decryption \
  --query Parameter.Value --output text 2>/dev/null)"; then
  echo "listmonk: $param is not set; skipped"
  exit 0
fi
field() { python3 -c 'import json,sys; sys.stdout.write(json.loads(sys.argv[1]).get(sys.argv[2],""))' "$secrets" "$1"; }
admin_user="$(field admin_user)" admin_pw="$(field admin_password)" db_pw="$(field db_password)"
unset secrets
# The password goes into SQL: letters and digits only.
for v in "$admin_user" "$admin_pw" "$db_pw"; do
  if ! [[ "$v" =~ ^[A-Za-z0-9]{12,}$ ]]; then
    echo "listmonk: $param needs admin_user, admin_password and db_password, letters and digits, 12+ characters" >&2
    exit 1
  fi
done

# The role and the database, on the box Postgres. Safe to run again; the password is set each time.
pguser="$(docker exec wren-pg printenv POSTGRES_USER)"
psql() { docker exec -i wren-pg psql -q -v ON_ERROR_STOP=1 -U "$pguser" -d postgres "$@"; }
psql <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'listmonk') THEN CREATE ROLE listmonk LOGIN; END IF;
END \$\$;
ALTER ROLE listmonk PASSWORD '$db_pw';
SQL
if [ "$(psql -tA -c "SELECT 1 FROM pg_database WHERE datname = 'listmonk'")" != 1 ]; then
  psql -c "CREATE DATABASE listmonk OWNER listmonk"
fi

# Loopback only. Two connections are enough; Postgres allows 60 and the worker, CLI and PgBouncer share them.
umask 077
mkdir -p "$D"
cat > "$D/listmonk.env.new" <<ENV
LISTMONK_app__address=127.0.0.1:9000
LISTMONK_db__host=127.0.0.1
LISTMONK_db__port=5432
LISTMONK_db__user=listmonk
LISTMONK_db__password=$db_pw
LISTMONK_db__database=listmonk
LISTMONK_db__ssl_mode=require
LISTMONK_db__max_open=4
LISTMONK_db__max_idle=2
LISTMONK_ADMIN_USER=$admin_user
LISTMONK_ADMIN_PASSWORD=$admin_pw
ENV
unset admin_pw db_pw

dirty=1
if [ -f "$D/listmonk.env" ] && cmp -s "$D/listmonk.env" "$D/listmonk.env.new"; then dirty=0; fi
mv "$D/listmonk.env.new" "$D/listmonk.env"
if [ "$dirty" = 0 ] &&
  [ "$(docker inspect -f '{{.State.Running}} {{.Config.Image}}' "$name" 2>/dev/null)" = "true $image" ]; then
  echo "listmonk unchanged, left running"
  exit 0
fi

# --install --idempotent makes the tables once; --upgrade moves them to this version.
docker pull -q "$image" >/dev/null
docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" --restart unless-stopped --network host --memory 128m \
  --log-opt max-size=20m --log-opt max-file=3 --env-file "$D/listmonk.env" "$image" \
  sh -c "./listmonk --install --idempotent --yes --config '' && ./listmonk --upgrade --yes --config '' && ./listmonk --config ''" >/dev/null
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9000/admin/login || true)"
  [ "$code" = 200 ] && break
  sleep 1
done
[ "$code" = 200 ] || { echo "listmonk did not answer on 9000 (last status $code)" >&2; exit 1; }
echo "listmonk started: $image"
