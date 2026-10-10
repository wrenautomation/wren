#!/usr/bin/env python3
"""Runs ON the box every 5 minutes: ping Discord when Restate is down or restarting.

Everything else that alerts runs through Restate, so its own outage was silent: on 2026-10-10
it OOM-looped 139 times over ~45 minutes before anyone looked. Down = the admin health check
fails twice in a row, or the container restarted 3+ times since the last run. At most one ping
an hour while down, and one when it's back. Webhook: WREN_DISCORD_WEBHOOK_URL in /wren/prod/env.
"""
import json
import subprocess
import time
import urllib.request

STATE = "/var/lib/wren-pg/restate-watch.json"
REGION = "us-east-1"


def healthy():
    try:
        return urllib.request.urlopen("http://127.0.0.1:9070/health", timeout=10).status == 200
    except Exception:
        return False


def restarts():
    out = subprocess.run(
        ["docker", "inspect", "-f", "{{.RestartCount}}", "wren-restate"],
        capture_output=True, text=True,
    )
    return int(out.stdout.strip() or 0) if out.returncode == 0 else -1


def ping(text):
    raw = subprocess.run(
        ["aws", "ssm", "get-parameter", "--region", REGION, "--name", "/wren/prod/env",
         "--with-decryption", "--query", "Parameter.Value", "--output", "text"],
        capture_output=True, text=True, check=True,
    ).stdout
    env = json.loads(raw)
    who = env.get("WREN_DISCORD_PING_USER_ID")
    body = {"content": f"<@{who}> {text}" if who else text}
    req = urllib.request.Request(
        env["WREN_DISCORD_WEBHOOK_URL"], data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "user-agent": "wren-restate-watch"},
    )
    urllib.request.urlopen(req, timeout=15)


try:
    with open(STATE) as f:
        st = json.load(f)
except Exception:
    st = {}
now, ok, count = time.time(), healthy(), restarts()
misses = 0 if ok else st.get("misses", 0) + 1
looping = count >= 0 and "restarts" in st and count - st["restarts"] >= 3
down = misses >= 2 or looping
if down and now - st.get("pinged", 0) > 3600:
    why = f"restarted {count - st['restarts']}x in 5 min" if looping else "health check failing"
    ping(f"Restate on the box is down ({why}). Every Wren service is off until it's back. "
         "Look: `docker logs --tail 50 wren-restate`, `dmesg -T | tail` (OOM?).")
    st["pinged"] = now
elif not down and st.get("pinged"):
    ping("Restate on the box is back.")
    st["pinged"] = 0
st.update(misses=misses, restarts=count)
with open(STATE, "w") as f:
    json.dump(st, f)
