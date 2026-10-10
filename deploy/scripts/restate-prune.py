#!/usr/bin/env python3
"""Runs ON the box: drop Restate deployments nothing uses anymore.

Every push registers a Lambda version and every desk deploy an endpoint; Restate keeps them all
in one metadata entry with a 30.4 MiB cap. Past it, registering fails and recovery after a
restart blew the 1g container (2026-10-10, 120 deployments). Kept: each service's current
deployment, any deployment a not-yet-completed invocation is pinned to, and the newest three.
CI runs it before each register; cron runs it hourly. `--dry` prints what it would drop.
"""
import json
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
