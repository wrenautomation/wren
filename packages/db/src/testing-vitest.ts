/**
 * The one vitest config of every package, `export { default } from "@wren/db/testing/vitest"`.
 * Two projects: unit tests need nothing; integration tests (test/integration) get the run's
 * shared Postgres from the global setup. Vitest starts a project's global setup only when that
 * project has files to run, so `vitest run src` starts no container.
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const globalSetup = fileURLToPath(new URL("./testing-global-setup.ts", import.meta.url));

// Vitest keeps transformed modules in <tmpdir>/<21-char nanoid>/ssr and removes the dir only on a
// clean close; killed runs left 6217 of them, 20.6 GB (10-23). Its own dir takes the path before
// this config loads, so moving TMPDIR here cannot help. Each run removes leaks idle over an hour.
function pruneLeakedRuns(): void {
  const cutoff = Date.now() - 3_600_000;
  for (const root of new Set([tmpdir(), "/private/tmp"])) {
    let names: string[] = [];
    try {
      names = readdirSync(root).filter((n) => /^[\w-]{21}$/.test(n));
    } catch {}
    for (const name of names) {
      try {
        const dir = join(root, name);
        if (Math.max(statSync(dir).mtimeMs, statSync(join(dir, "ssr")).mtimeMs) < cutoff)
          rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  }
}
pruneLeakedRuns();

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
