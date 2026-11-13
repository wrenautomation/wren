/**
 * AerieConsole: the portal's Aerie app. Aerie owns the routes, inputs and rules (`@wrenautomation/aerie/http`);
 * this maps the viewer's email to an Aerie actor and Aerie's no to a PortalRefusal.
 */
import {
  answer,
  PortalRefusal,
  type PortalRequest,
  portalService,
  type SignedViewer,
} from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type * as restate from "@wren/runtime";
import { AerieError } from "@wrenautomation/aerie";
import { AERIE_ROUTES, type AerieRoute, aerieRoutes } from "@wrenautomation/aerie/http";
import { z } from "zod";
import { AERIE_CONSOLE_APPS, AERIE_CONSOLE_ROUTES } from "./console-routes.js";
import { aerie } from "./index.js";

type Req = PortalRequest & Record<string, unknown>;

/** Aerie's no → a PortalRefusal; a stale version is wren's `conflict` (Keep mine / Use theirs) */
const refuse = async <T>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AerieError)
      throw new PortalRefusal(
        err.message,
        err.status,
        undefined,
        err.status === 409 ? "conflict" : undefined,
      );
    throw err;
  }
};

export function aerieConsoleApi(db: Db) {
  const routes = aerieRoutes(aerie(db));
  return (k: AerieRoute, req: Req) =>
    refuse(async () =>
      routes.call(k, req, await routes.viewer((req.viewer as SignedViewer).email)),
    );
}

export function makeAerieConsole(db: Db) {
  const api = aerieConsoleApi(db);
  // Aerie validates its own input; the host schema carries the portal's fields only
  const h = (k: AerieRoute) =>
    serviceHandler(
      { input: z.looseObject(PORTAL_FIELDS) },
      (_: restate.Context, req: Req): Promise<unknown> => answer(() => api(k, req)),
    );
  return portalService({
    name: "AerieConsole",
    main: db,
    routes: AERIE_CONSOLE_ROUTES,
    apps: AERIE_CONSOLE_APPS,
    unnamed: "wren",
    handlers: Object.fromEntries(AERIE_ROUTES.map((k) => [k, h(k)])) as Record<
      AerieRoute,
      ReturnType<typeof h>
    >,
  });
}
