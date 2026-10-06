import * as restate from "@restatedev/restate-sdk";
import {
  RestateContainer,
  RestateTestEnvironment,
  type TestEnvironmentOptions,
} from "@restatedev/restate-sdk-testcontainers";
import { selfRemoving } from "@wren/db/testing";
import { SPINE, type SpineEvent } from "./spine.js";

/** Restate for one test file, sized for tests: one partition and a 64 MiB RocksDB take a container
 *  from about 630 MB to 230 MB. A custom container skips the helper's own replay and retry flags,
 *  so they are applied here. The services are reached through host.docker.internal, which skips
 *  testcontainers' sshd port-forwarding container. */
export function startTestRestate(options: TestEnvironmentOptions): Promise<RestateTestEnvironment> {
  return RestateTestEnvironment.start({
    serviceEndpointAccess: "docker-host",
    ...options,
    container: () => {
      const container = selfRemoving(new RestateContainer(), [
        "/usr/local/bin/restate-server",
      ]).withEnvironment({
        RESTATE_DEFAULT_NUM_PARTITIONS: "1",
        RESTATE_ROCKSDB_TOTAL_MEMORY_SIZE: "64MiB",
      });
      if (options.alwaysReplay) container.alwaysReplay();
      if (options.disableRetries) container.disableRetries();
      return container;
    },
  });
}

/** A Spine that only records what parts emit, for a test whose service sends along a workflow. */
export function spineRecorder() {
  const emitted: { client: string | null; workflow: string; from: string; events: SpineEvent[] }[] =
    [];
  const service = restate.service({
    name: SPINE.name,
    handlers: {
      emit: async (_ctx: restate.Context, req: (typeof emitted)[number]) => {
        emitted.push(req);
        return { arrived: 0, seen: 0, waiting: 0, failed: 0, out: 0 };
      },
    },
  });
  return { service, emitted };
}
