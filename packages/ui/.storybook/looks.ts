/**
 * The looks each story is tested in: Wren's own (raycast) in both themes and both widths, a phone's
 * and a desktop's; the empty pass wears a client's (wren).
 * Two passes cover all four: axe reads each theme's contrast, and each width's layout once.
 * One Vitest project each (vitest.config.ts); run.mjs runs them one after another.
 */
export const LOOKS = [
  { look: "raycast", theme: "light", viewport: "phone", name: "light-390" },
  { look: "raycast", theme: "dark", viewport: "desktop", name: "dark-1280" },
] as const;

/**
 * The portal's page stories once more with no records: each shows its empty state (mocks/page.tsx).
 * In wren, a client's look: raycast is Wren's own (2026-11-27), so this pass keeps the clients' look tested.
 */
export const EMPTY_PASS = {
  look: "wren",
  theme: "light",
  viewport: "desktop",
  name: "empty-1280",
} as const;
