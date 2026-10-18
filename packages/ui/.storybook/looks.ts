/**
 * The looks each story is tested in: both themes, and both widths, a phone's and a desktop's.
 * Two passes cover all four: axe reads each theme's contrast, and each width's layout once.
 * One Vitest project each (vitest.config.ts); run.mjs runs them one after another.
 */
export const LOOKS = [
  { theme: "light", viewport: "phone", name: "light-390" },
  { theme: "dark", viewport: "desktop", name: "dark-1280" },
] as const;
