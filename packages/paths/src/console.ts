/**
 * PathsConsole: Explorer's server roots (designs/2026-11-12-explorer.md D2). Canon runs here;
 * Weaver runs in the browser, beside `weaver serve`. A fresh adapter per call: its loads are
 * that call's.
 */

import { childrenAt, columns, homeAt, PathError, rootOf, wholeAt } from "@wren/core/paths";
import { answer, PortalRefusal, type PortalRequest, portalService } from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import type * as restate from "@wren/runtime";
import { z } from "zod";
import { PATH_ERROR_STATUS, PATHS_CONSOLE_APPS, PATHS_CONSOLE_ROUTES } from "./console-routes.js";
import { type PathsDeps, serverRoots } from "./roots.js";

type Req = PortalRequest & Record<string, unknown>;
const PATH = z.string().min(1).max(2000);
const INPUTS = {
  columns: { route: PATH },
  children: { path: PATH, after: z.string().max(40).nullish() },
  whole: { path: PATH },
  find: { q: z.string().min(1).max(200), under: PATH.nullish() },
} as const;

/** What each route answers: the portal's mocks type their answers by it. */
export type PathsConsoleApi = ReturnType<typeof pathsConsoleApi>;

function pathsConsoleApi(d: PathsDeps) {
  const roots = serverRoots(d);
  const adapter = (path: string) => {
    const make = roots[rootOf(path)];
    if (!make) throw new PortalRefusal(`unknown-path: no root ${rootOf(path)} here`, 404);
    return make();
  };
  const refuse = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof PathError)
        throw new PortalRefusal(`${e.code}: ${e.message}`, PATH_ERROR_STATUS[e.code]);
      throw e;
    }
  };
  return {
    columns: (req: Req) => refuse(() => columns(adapter(String(req.route)), String(req.route))),
    children: (req: Req) =>
      refuse(() =>
        childrenAt(
          adapter(String(req.path)),
          String(req.path),
          (req.after as string | null) ?? undefined,
        ),
      ),
    whole: (req: Req) => refuse(() => wholeAt(adapter(String(req.path)), String(req.path))),
    find: (req: Req) => {
      const under = (req.under as string | null) ?? "canon";
      return refuse(async () => {
        const a = adapter(under);
        return { items: await a.find(String(req.q), await homeAt(a, under)) };
      });
    },
  };
}

export function makePathsConsole(d: PathsDeps) {
  const api = pathsConsoleApi(d);
  const h = (k: keyof typeof INPUTS) =>
    serviceHandler(
      { input: z.looseObject({ ...PORTAL_FIELDS, ...INPUTS[k] }) },
      (_: restate.Context, req: Req): Promise<unknown> =>
        answer(() => (api[k] as (r: Req) => Promise<unknown>)(req)),
    );
  return portalService({
    name: "PathsConsole",
    main: d.db,
    routes: PATHS_CONSOLE_ROUTES,
    apps: PATHS_CONSOLE_APPS,
    unnamed: "wren",
    handlers: {
      columns: h("columns"),
      children: h("children"),
      whole: h("whole"),
      find: h("find"),
    },
  });
}
