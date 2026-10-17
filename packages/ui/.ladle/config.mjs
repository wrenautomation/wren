/**
 * Ladle, the component workbench for `@wren/ui` (designs/2026-10-17-ui-workbench-and-fast-ci.md).
 * `pnpm --filter @wren/ui stories` serves it on :61000; `stories:build` writes `build/`.
 */
/** @type {import('@ladle/react').UserConfig} */
export default {
  stories: "src/**/*.stories.tsx",
  viteConfig: ".ladle/vite.config.ts",
  port: 61000,
  outDir: "build",
  addons: {
    // The phone shell switches under 900px (`PHONE`), so a phone width sits in the list.
    width: { enabled: true, options: { phone: 390, tablet: 820, desktop: 1280 }, defaultState: 0 },
    a11y: { enabled: true },
  },
};
