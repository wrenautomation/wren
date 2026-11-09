import type { Need, RouteApps } from "@wren/core/access";

/** VariantsConsole's handlers and what each needs. Wren's team only for now. Type imports only. */
export const VARIANTS_CONSOLE_ROUTES = {
  queue: "wren:team",
  subjects: "wren:team",
  subject: "wren:team",
  batches: "wren:team",
  catalog: "wren:team",
  judge: "wren:team",
  note: "wren:team",
  unnote: "wren:team",
  close: "wren:team",
  keep: "wren:team",
  rename: "wren:team",
  guide: "wren:team",
  setGuide: "wren:team",
  steer: "wren:team",
  unsteer: "wren:team",
} as const satisfies Record<string, Need>;
/** Variants: its own app, beside Research. */
export const VARIANTS_CONSOLE_APPS = { "*": "variants" } as const satisfies RouteApps<
  typeof VARIANTS_CONSOLE_ROUTES
>;
export const VARIANTS_CONSOLE_WRITES: readonly (keyof typeof VARIANTS_CONSOLE_ROUTES)[] = [
  "judge",
  "note",
  "unnote",
  "close",
  "keep",
  "rename",
  "guide",
  "setGuide",
  "steer",
  "unsteer",
];
