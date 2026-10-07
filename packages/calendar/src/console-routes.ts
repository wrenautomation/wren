import type { Need, RouteApps } from "@wren/core/access";

/**
 * CalendarConsole's handlers and what each needs (`range` reads the week; the rest write): the edge Worker opens only these. Wren's own
 * calendar, so Wren's team; a cancel mails the booker. Type imports only.
 */
export const CALENDAR_CONSOLE_ROUTES = {
  range: "wren:read",
  won: "wren:act",
  notYet: "wren:act",
  noShow: "wren:act",
  notFit: "wren:act",
  clear: "wren:act",
  cancel: "wren:effect",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): the Calendar. */
export const CALENDAR_CONSOLE_APPS = { "*": "calendar" } as const satisfies RouteApps<
  typeof CALENDAR_CONSOLE_ROUTES
>;
export const CALENDAR_CONSOLE_WRITES: readonly (keyof typeof CALENDAR_CONSOLE_ROUTES)[] = [
  "won",
  "notYet",
  "noShow",
  "notFit",
  "clear",
  "cancel",
];
