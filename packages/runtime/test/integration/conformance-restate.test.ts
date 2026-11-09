// Today's truth: the conformance suite on Restate 1.7 (designs/2026-11-09-own-runtime.md).
import * as sdk from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateContainer, RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { selfRemoving } from "@wren/db/testing";
import { conformance, type Status } from "./conformance/scenarios.js";

conformance("restate", { sdk, clients }, async (services) => {
  // Sized as @wren/core's startTestRestate; reached through host.docker.internal.
  const env = await RestateTestEnvironment.start({
    services,
    serviceEndpointAccess: "docker-host",
    container: () =>
      selfRemoving(new RestateContainer(), ["/usr/local/bin/restate-server"]).withEnvironment({
        RESTATE_DEFAULT_NUM_PARTITIONS: "1",
        RESTATE_ROCKSDB_TOTAL_MEMORY_SIZE: "64MiB",
      }),
  });
  const admin = env.adminAPIBaseUrl();
  return {
    ingress: clients.connect({ url: env.baseUrl() }),
    missingId: "inv_1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    async status(id: string): Promise<Status> {
      const res = await fetch(`${admin}/query`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ query: `SELECT status FROM sys_invocation WHERE id = '${id}'` }),
      });
      const rows = ((await res.json()) as { rows: { status: string }[] }).rows;
      const s = rows[0]?.status;
      return s === "completed" ? "completed" : s === "paused" ? "paused" : "other";
    },
    stop: () => env.stop(),
  };
});
