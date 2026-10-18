/**
 * Every story as a test (designs/2026-10-17-storybook-visual-tests.md): it renders, its `play`
 * runs, axe checks it. Two projects (looks.ts): light at 390, dark at 1280. Shared by each
 * Storybook (`@wren/ui/storybook/tests`); run it through `wren-stories` (run.mjs), which queues on
 * the Mac's checks lock.
 */
import { join, resolve } from "node:path";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
// `.ts`: another package's Vitest loads this file in Node, which maps no `.js` to `.ts`.
import { LOOKS } from "./looks.ts";

/** run.mjs starts one Chromium and passes its address: the projects share it. */
const shared = process.env.WREN_UI_BROWSER;

/** The story-test config for the Storybook in `configDir` (a package's `.storybook`). */
export function storyTests(configDir: string) {
  return defineConfig({
    root: resolve(configDir, ".."),
    test: {
      // A fixed count, not one per core: memory stays bounded. CI's runner has 4 cores to itself.
      maxWorkers: process.env.GITHUB_ACTIONS ? 4 : 2,
      projects: LOOKS.map(({ theme, viewport, name }) => ({
        extends: true,
        plugins: [
          storybookTest({ configDir, initialGlobals: { theme, viewport: { value: viewport } } }),
        ],
        test: {
          name,
          setupFiles: [join(import.meta.dirname, "vitest.setup.ts")],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              ...(shared ? { connectOptions: { wsEndpoint: shared } } : {}),
              contextOptions: {
                reducedMotion: "reduce",
                colorScheme: theme,
                locale: "en-US",
                timezoneId: "UTC",
                deviceScaleFactor: 1,
              },
            }),
            instances: [{ browser: "chromium" }],
          },
        },
      })),
    },
  });
}
