/** FoldersConsole: the tree for every list in the portal (designs/2026-11-08-folders.md). */

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
import { z } from "zod";
import { FOLDERS_CONSOLE_APPS, FOLDERS_CONSOLE_ROUTES } from "./console-routes.js";
import { FolderError, folderTree, ITEM_KINDS } from "./index.js";

type Req = PortalRequest & Record<string, unknown>;
const by = (req: PortalRequest) => (req.viewer as SignedViewer).email;
const refuse = async <T>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof FolderError) throw new PortalRefusal(err.message, err.status);
    throw err;
  }
};

const id = z.number().int().positive();
const INPUTS = {
  tree: { kind: z.enum(ITEM_KINDS).optional() },
  make: { name: z.string(), parent: id.nullish() },
  rename: { id, name: z.string() },
  move: { id, to: id.nullable() },
  drop: { id },
  file: {
    kind: z.enum(ITEM_KINDS),
    refs: z.array(z.string()).min(1).max(200),
    folder: id.nullable(),
  },
} as const;

export function foldersConsoleApi(db: Db) {
  const t = folderTree(db);
  return {
    tree: (req: Req) => t.tree(req.kind as (typeof ITEM_KINDS)[number] | undefined),
    make: (req: Req) =>
      refuse(() =>
        t.make({ name: req.name as string, parent: req.parent as number | null, by: by(req) }),
      ),
    rename: (req: Req) => refuse(() => t.rename(req.id as number, req.name as string, by(req))),
    move: (req: Req) => refuse(() => t.move(req.id as number, req.to as number | null, by(req))),
    drop: (req: Req) => refuse(() => t.drop(req.id as number, by(req))),
    file: (req: Req) =>
      refuse(() =>
        t.file({
          kind: req.kind as string,
          refs: req.refs as string[],
          folder: req.folder as number | null,
          by: by(req),
        }),
      ),
  };
}

export function makeFoldersConsole(db: Db) {
  const api = foldersConsoleApi(db);
  const h = (k: keyof typeof INPUTS) =>
    serviceHandler(
      { input: z.looseObject({ ...PORTAL_FIELDS, ...INPUTS[k] }) },
      (_: restate.Context, req: Req): Promise<unknown> =>
        answer(() => (api[k] as (r: Req) => Promise<unknown>)(req)),
    );
  return portalService({
    name: "FoldersConsole",
    main: db,
    routes: FOLDERS_CONSOLE_ROUTES,
    apps: FOLDERS_CONSOLE_APPS,
    unnamed: "wren",
    handlers: {
      tree: h("tree"),
      make: h("make"),
      rename: h("rename"),
      move: h("move"),
      drop: h("drop"),
      file: h("file"),
    },
  });
}
