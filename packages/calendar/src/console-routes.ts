import type { Need } from "@wren/core/access";

/**
 * CalendarConsole's handlers and what each needs: the edge Worker opens only these. Wren's own
 * calendar, so Wren's team; a cancel mails the booker. Type imports only.
 */
export const CALENDAR_CONSOLE_ROUTES = {
  held: "wren:act",
  noShow: "wren:act",
  clear: "wren:act",
  cancel: "wren:effect",
} as const satisfies Record<string, Need>;
export const CALENDAR_CONSOLE_WRITES: readonly (keyof typeof CALENDAR_CONSOLE_ROUTES)[] = [
  "held",
  "noShow",
  "clear",
  "cancel",
];
