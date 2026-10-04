import {
  RestateContainer,
  RestateTestEnvironment,
  type TestEnvironmentOptions,
} from "@restatedev/restate-sdk-testcontainers";
import { selfRemoving } from "@wren/db/testing";

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
