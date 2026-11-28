#!/bin/bash
# @unit nats: JetStream for run events (the CDC relay, packages/runtime/src/pg/relay.ts), on 127.0.0.1:4222.
# Runs ON the Postgres box (CI sends it over SSM). The box worker's relay publishes rt.events
# here (WREN_NATS_URL). The stream is a copy, the table is the truth: a lost store costs a replay.
# Same config, image and running: left alone.
set -euo pipefail
dir=/var/lib/wren-pg/nats
image=nats:2.15.1-alpine

mkdir -p "$dir/store"
# loopback only: nothing off the box reads it; the door's /rt/events serves the CLI
cat > "$dir/nats.conf.new" <<'CONF'
server_name: wren-box
listen: 127.0.0.1:4222
http: 127.0.0.1:8222
jetstream {
  store_dir: /data
  max_memory_store: 64MB
  max_file_store: 2GB
}
CONF

if cmp -s "$dir/nats.conf" "$dir/nats.conf.new" &&
  [ "$(docker inspect -f '{{.State.Running}} {{.Config.Image}}' wren-nats 2>/dev/null)" = "true $image" ]; then
  rm -f "$dir/nats.conf.new"
  echo "nats unchanged, left running"
  exit 0
fi
mv "$dir/nats.conf.new" "$dir/nats.conf"

# A restart: the relay and consumers reconnect; the relay resends from its slot's last ack.
docker rm -f wren-nats >/dev/null 2>&1 || true
docker run -d --name wren-nats --restart unless-stopped --network host --memory 128m \
  --log-opt max-size=10m --log-opt max-file=3 \
  -v "$dir/nats.conf":/etc/nats/wren.conf:ro -v "$dir/store":/data \
  "$image" -c /etc/nats/wren.conf >/dev/null

# Up = healthz answers with JetStream on.
for _ in $(seq 1 15); do
  sleep 1
  if curl -fsS "http://127.0.0.1:8222/healthz?js-enabled-only=true" >/dev/null 2>&1; then
    echo "nats up"
    exit 0
  fi
done
echo "nats did not come up:"
docker logs --tail 30 wren-nats 2>&1 || true
exit 1
