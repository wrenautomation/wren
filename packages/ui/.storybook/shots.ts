/**
 * The shots: each story at a phone and a desktop width, in each look. One Vitest project each
 * (vitest.config.ts); run.mjs runs them one after another, so one opens its pages at a time.
 */
export const SHOTS = [
  { theme: "light", viewport: "phone", name: "light-390" },
  { theme: "light", viewport: "desktop", name: "light-1280" },
  { theme: "dark", viewport: "phone", name: "dark-390" },
  { theme: "dark", viewport: "desktop", name: "dark-1280" },
] as const;
