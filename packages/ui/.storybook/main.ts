/**
 * Storybook config for the `@wren/ui` parts alone (designs/2026-10-17-storybook-visual-tests.md):
 * `test:stories` runs every story as a Vitest test (vitest.config.ts, through run.mjs);
 * `stories:build` writes `storybook-static/`. To look at the parts, `pnpm storybook` (repo root)
 * serves them with the portal pages on :61000 (apps/portal/.storybook/main.ts, WA-1098).
 */
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-vitest"],
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  // No docs pages: prop tables would parse every part's types on each start.
  typescript: { reactDocgen: false },
  // The portal's own React and Tailwind plugins (apps/portal/web/vite.config.ts).
  viteFinal: (vite) =>
    mergeConfig(vite, {
      plugins: [react(), tailwindcss()],
      build: { chunkSizeWarningLimit: 2000 },
    }),
};
export default config;
