import type { Need, RouteApps } from "@wren/core/access";

/** VariantsConsole's handlers and what each needs. Wren's team only for now. Type imports only. */
export const VARIANTS_CONSOLE_ROUTES = {
  queue: "wren:team",
  subjects: "wren:team",
  subject: "wren:team",
  catalog: "wren:team",
  judge: "wren:team",
  note: "wren:team",
  unnote: "wren:team",
  close: "wren:team",
  keep: "wren:team",
  guide: "wren:team",
  setGuide: "wren:team",
} as const satisfies Record<string, Need>;
/** Campaigns › Variants. */
export const VARIANTS_CONSOLE_APPS = { "*": "campaigns" } as const satisfies RouteApps<
  typeof VARIANTS_CONSOLE_ROUTES
>;
export const VARIANTS_CONSOLE_WRITES: readonly (keyof typeof VARIANTS_CONSOLE_ROUTES)[] = [
  "judge",
  "note",
  "unnote",
  "close",
  "keep",
  "guide",
  "setGuide",
];
