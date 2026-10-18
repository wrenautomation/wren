/**
 * Every story as a test (designs/2026-10-17-storybook-visual-tests.md): it renders, its `play`
 * runs, axe checks it, and `vitest.setup.ts` compares a screenshot with the committed baseline.
 * Four projects: light and dark, at 390 and 1280. Run it with `pnpm --filter @wren/ui test:stories`
 * (run.mjs), which uses the Playwright image off Linux: baselines come from that image only.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { SHOTS } from "./shots.js";

const configDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(configDir, "..");

// macOS draws text a few pixels off Linux: a Mac run would fail every baseline. run.mjs sets this.
if (process.platform !== "linux") {
  throw new Error("test:stories runs on Linux only: use `pnpm --filter @wren/ui test:stories`.");
}

declare module "vitest" {
  interface ProvidedContext {
    /** This project's shot, `<theme>-<width>`: the end of each baseline's name. */
    shot: string;
  }
}

/** run.mjs starts one Chromium and passes its address: the projects share it. */
const shared = process.env.WREN_UI_BROWSER;

export default defineConfig({
  root,
  test: {
    // A fixed count, not one per core: memory stays bounded. CI's runner has 4 cores to itself.
    maxWorkers: process.env.GITHUB_ACTIONS ? 4 : 2,
    // Diffs go to test-results/visual/ (gitignored), uploaded by CI on a failure.
    attachmentsDir: join(root, "test-results"),
    projects: SHOTS.map(({ theme, viewport, name }) => ({
      extends: true,
      plugins: [
        storybookTest({ configDir, initialGlobals: { theme, viewport: { value: viewport } } }),
      ],
      test: {
        name,
        provide: { shot: name },
        setupFiles: [join(configDir, "vitest.setup.ts")],
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
          expect: {
            toMatchScreenshot: {
              // One file per story and shot: __screenshots__/<title>/<story>-<theme>-<width>.png.
              resolveScreenshotPath: ({ arg, ext }) =>
                join(root, "__screenshots__", `${arg}${ext}`),
              resolveDiffPath: ({ arg, ext }) =>
                join(root, "test-results", "visual", `${arg}${ext}`),
              comparatorName: "pixelmatch",
              // Antialias noise passes; a real change (a moved line, a new colour) fails.
              comparatorOptions: { threshold: 0.2, allowedMismatchedPixelRatio: 0.0005 },
            },
          },
        },
      },
    })),
  },
});
