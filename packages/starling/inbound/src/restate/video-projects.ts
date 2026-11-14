/**
 * `VideoProjectDesk/wren` (designs/2026-11-13-studio-suite.md, D1): Studio's Projects page reads
 * and writes video projects through the console. The page joins Pieces and Vireo's queue itself.
 */

import { byOf } from "@wren/core/ask";
import { exclusiveHandler, NO_INPUT, PORTAL_FIELDS, sharedHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import * as restate from "@wren/runtime";
import {
  listProjects,
  newProject,
  ProjectRefusal,
  projectInputSchema,
  projectPatchSchema,
  setProject,
} from "@wren/starling-studio/projects";
import { z } from "zod";

const PROJECTS_KEY = "wren";

const own = (ctx: { key: string }) => {
  if (ctx.key !== PROJECTS_KEY) throw new restate.TerminalError("projects are Wren's own");
};
/** A zod no or a project refusal → terminal, so a retry never repeats it. */
const terminal = (err: unknown): never => {
  if (err instanceof z.ZodError)
    throw new restate.TerminalError(err.issues[0]?.message ?? "bad input", { errorCode: 400 });
  if (err instanceof ProjectRefusal)
    throw new restate.TerminalError(err.message, { errorCode: 404 });
  throw err;
};
const parse = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (err) {
    return terminal(err);
  }
};

const ADD_INPUT = z.looseObject({ ...PORTAL_FIELDS, ...projectInputSchema.shape });
const SET_INPUT = z.looseObject({
  ...PORTAL_FIELDS,
  id: z.number().int().positive(),
  patch: z.looseObject({}),
});

export function makeVideoProjects(deps: { db: Db }) {
  return restate.object({
    name: "VideoProjectDesk",
    handlers: {
      /** Every project, newest change first. */
      list: sharedHandler({ input: NO_INPUT }, async (ctx: restate.ObjectSharedContext) => {
        own(ctx);
        const projects = await ctx.run("rows", () => listProjects(deps.db));
        return { projects };
      }),
      add: exclusiveHandler(
        { input: ADD_INPUT },
        async (ctx: restate.ObjectContext, req: z.infer<typeof ADD_INPUT>) => {
          own(ctx);
          const input = parse(() => projectInputSchema.parse(req));
          const project = await ctx.run("add", () => newProject(deps.db, input, byOf(req)));
          return { project };
        },
      ),
      set: exclusiveHandler(
        { input: SET_INPUT },
        async (ctx: restate.ObjectContext, req: z.infer<typeof SET_INPUT>) => {
          own(ctx);
          const patch = parse(() => projectPatchSchema.parse(req.patch));
          // a refusal comes back as a value: a throw inside run would be retried
          const out = await ctx.run("set", () =>
            setProject(deps.db, req.id, patch).then(
              (project) => ({ project, no: null }),
              (err) => {
                if (err instanceof ProjectRefusal) return { project: null, no: err.message };
                throw err;
              },
            ),
          );
          if (out.no !== null) throw new restate.TerminalError(out.no, { errorCode: 404 });
          const project = out.project;
          return { project };
        },
      ),
    },
  });
}
