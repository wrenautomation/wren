/**
 * The one vitest config of every package, `export { default } from "@wren/db/testing/vitest"`.
 * Two projects: unit tests need nothing; integration tests (test/integration) get the run's
 * shared Postgres from the global setup. Vitest starts a project's global setup only when that
 * project has files to run, so `vitest run src` starts no container.
 */
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const globalSetup = fileURLToPath(new URL("./testing-global-setup.ts", import.meta.url));

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 180_000,
    projects: [
      {
        extends: true,
        test: { name: "unit", exclude: [...configDefaults.exclude, "test/integration/**"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["test/integration/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
          globalSetup: [globalSetup],
        },
      },
    ],
  },
});
