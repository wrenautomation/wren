import {
  RestateContainer,
  RestateTestEnvironment,
  type TestEnvironmentOptions,
} from "@restatedev/restate-sdk-testcontainers";

/** Restate for one test file, sized for tests: one partition and a 64 MiB RocksDB take a container
 *  from about 630 MB to 230 MB. A custom container skips the helper's own replay and retry flags,
 *  so they are applied here. */
export function startTestRestate(options: TestEnvironmentOptions): Promise<RestateTestEnvironment> {
  return RestateTestEnvironment.start({
    ...options,
    container: () => {
      const container = new RestateContainer().withEnvironment({
        RESTATE_DEFAULT_NUM_PARTITIONS: "1",
        RESTATE_ROCKSDB_TOTAL_MEMORY_SIZE: "64MiB",
      });
      if (options.alwaysReplay) container.alwaysReplay();
      if (options.disableRetries) container.disableRetries();
      return container;
    },
  });
}
