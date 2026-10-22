/**
 * Storybook for the portal's pages and shell (designs/2026-10-18-portal-page-stories.md): the
 * real app on a fake server (MSW, `web/src/mocks/`). `pnpm --filter @wren/portal storybook`
 * serves it on :61001; `test:stories` runs every story as a Vitest test (vitest.config.ts).
 */

import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { mergeConfig, type Plugin, runnerImport } from "vite";
import { nodeStubs } from "../web/node-stubs.js";

/**
 * Dictation asks `GET /api/dictate` as the app loads, before MSW starts; the dev server says it is
 * off. A static build has no answer and the app reads that as off too.
 */
const dictateOff: Plugin = {
  name: "dictate-off",
  configureServer(server) {
    server.middlewares.use("/api/dictate", (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ on: false, model: null }));
    });
  },
};

/**
 * `virtual:record-types`: the meta of every record type the worker serves
 * (`apps/worker/src/record-types.ts`, the list the worker and the preview serve from). Read once
 * per start, in Node: those modules reach the database and can't load in the browser.
 */
const TYPES = "virtual:record-types";
const WORKER = fileURLToPath(new URL("../../worker", import.meta.url));
let types: Promise<string> | undefined;
const recordTypes: Plugin = {
  name: "record-types",
  resolveId: (id) => (id === TYPES ? `\0${TYPES}` : null),
  load(id) {
    if (id !== `\0${TYPES}`) return null;
    types ??= runnerImport<{ recordMetas: () => unknown[] }>(`${WORKER}/src/record-types.ts`, {
      configFile: false,
      root: WORKER,
      logLevel: "error",
    }).then(({ module }) => `export default ${JSON.stringify(module.recordMetas())};`);
    return types;
  },
};

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../web/src/**/*.stories.tsx"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-vitest", "msw-storybook-addon"],
  // The app's own files (icons), and the service worker MSW answers from (`msw init`), kept here
  // so the app's build never ships it.
  staticDirs: ["./public", "../web/public"],
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  // No docs pages: prop tables would parse every page's types on each start.
  typescript: { reactDocgen: false },
  // The app's own React and Tailwind plugins (web/vite.config.ts).
  viteFinal: (vite) =>
    mergeConfig(vite, {
      plugins: [nodeStubs, dictateOff, recordTypes, react(), tailwindcss()],
      build: { chunkSizeWarningLimit: 4000 },
    }),
};
export default config;
