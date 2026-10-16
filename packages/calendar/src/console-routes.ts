import type { Need, RouteApps } from "@wren/core/access";

/**
 * CalendarConsole's handlers and what each needs (`range` and `records*` read; the rest write):
 * the edge Worker opens only these. Wren's calendar with no client named (Wren's team), else the
 * client's; a cancel mails the booker. `recorder`, `record` and `stopRecording` ask the Mac's call
 * recorder (`recorder.ts`), Wren's team only. Type imports only.
 */
export const CALENDAR_CONSOLE_ROUTES = {
  range: "read",
  recordsTypes: "read",
  recordsList: "read",
  recordsGet: "read",
  recordsExport: "read",
  recordsStats: "read",
  won: "act",
  notYet: "act",
  noShow: "act",
  notFit: "act",
  clear: "act",
  cancel: "effect",
  recorder: "read",
  record: "act",
  stopRecording: "act",
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
  "record",
  "stopRecording",
];
