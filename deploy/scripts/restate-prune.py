#!/usr/bin/env python3
"""Runs ON the box: drop Restate deployments nothing uses anymore.

Every push registers a Lambda version and every desk deploy an endpoint; Restate keeps them all
in one metadata entry with a 30.4 MiB cap. Past it, registering fails and recovery after a
restart blew the 1g container (2026-10-10, 120 deployments). Kept: each service's current
deployment, any deployment a not-yet-completed invocation is pinned to, and the newest three.
It also stops `wren-worker-old` (box-worker.sh's previous slot) once no open call is pinned to
it: on the 2 GB box (10-17) its ~270 MB is room Restate needs.
CI runs it before each register; cron runs it hourly. `--dry` prints what it would drop.
"""
import json
import subprocess
import sys
import urllib.request

ADMIN = "http://127.0.0.1:9070"
NEWEST = 3


def query(sql):
    req = urllib.request.Request(
        f"{ADMIN}/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"content-type": "application/json", "accept": "application/json"},
    )
    return json.load(urllib.request.urlopen(req, timeout=60))["rows"]


deps = query("select id from sys_deployment order by created_at desc")
keep = {r["deployment_id"] for r in query("select deployment_id from sys_service")}
keep |= {
    r["d"]
    for r in query(
        "select distinct pinned_deployment_id d from sys_invocation"
        " where status <> 'completed' and pinned_deployment_id is not null"
    )
}
keep |= {d["id"] for d in deps[:NEWEST]}
drop = [d["id"] for d in deps if d["id"] not in keep]
print(f"deployments {len(deps)}, dropping {len(drop)}")


def old_worker_port():
    """The previous slot's port while its container runs, else None."""
    out = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Running}} {{range .Config.Env}}{{println .}}{{end}}",
         "wren-worker-old"],
        capture_output=True, text=True,
    )
    if out.returncode != 0 or not out.stdout.startswith("true"):
        return None
    ports = [l.split("=", 1)[1] for l in out.stdout.split() if l.startswith("WREN_BOX_PORT=")]
    return ports[0] if ports else None


port = old_worker_port()
if port:
    open_calls = query(
        "select count(*) as n from sys_invocation i join sys_deployment d"
        " on d.id = i.pinned_deployment_id where i.status <> 'completed'"
        f" and d.endpoint = 'http://127.0.0.1:{port}/'"
    )[0]["n"]
    print(f"wren-worker-old (port {port}): {open_calls} open calls pinned")
    if open_calls == 0 and "--dry" not in sys.argv:
        # stop, not rm: the next deploy removes it, as before.
        subprocess.run(["docker", "stop", "wren-worker-old"], capture_output=True)
        print("stopped wren-worker-old")

if "--dry" in sys.argv:
    sys.exit(0)
failed = 0
for dep in drop:
    req = urllib.request.Request(f"{ADMIN}/deployments/{dep}?force=true", method="DELETE")
    try:
        urllib.request.urlopen(req, timeout=60)
    except Exception as e:  # one stuck deployment shouldn't keep the rest
        failed += 1
        print(f"{dep}: {str(e)[:200]}")
sys.exit(1 if failed else 0)
