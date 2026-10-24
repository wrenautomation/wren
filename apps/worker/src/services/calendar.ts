/**
 * Our booking calendar and each client's, through the phone Worker's /calendar door.
 */
import { CALENDAR } from "@wren/calendar";
import { makeCalendarConsole } from "@wren/calendar/console";
import {
  type CalendarDeps,
  type ClientCalendarDeps,
  makeCalendar,
  makeClientCalendar,
} from "@wren/calendar/restate";
import { settingsFor } from "@wren/core/clients";
import type { AnyService, Deps } from "./deps.js";

/** The calendar domain's services, in the order they were served from `services.ts`. */
export function calendarServices(deps: Deps): AnyService[] {
  const { bookerMailer, db, fireAll, googleCalendar, openClient, settings } = deps;
  const calendarDeps: CalendarDeps = {
    db,
    calendar: "wren",
    settings: async () => (await settingsFor(db, null))[CALENDAR] ?? {},
    host: googleCalendar,
    shared: settings.siteExportToken ?? null,
    site: settings.siteBaseUrl.replace(/\/+$/, ""),
    send: bookerMailer?.("Wren") ?? null,
    fire: fireAll,
  };
  // A client's booking calendar: its database, its connected Google account, its host. Its mail
  // and Google's invite wait on its sends flag (`ownerDeps`).
  const clientCalendarDeps: ClientCalendarDeps = {
    main: db,
    open: openClient,
    host: googleCalendar,
    shared: settings.siteExportToken ?? null,
    portal: settings.portalOrigin ?? "https://app.wrenautomation.com",
    mailer: bookerMailer,
    fire: fireAll,
  };
  const services: AnyService[] = [
    // Our booking calendar, through the phone Worker's /calendar door; its portal buttons.
    makeCalendar(calendarDeps),
    makeClientCalendar(clientCalendarDeps),
    makeCalendarConsole({ wren: calendarDeps, clients: clientCalendarDeps }),
  ];
  return services;
}
