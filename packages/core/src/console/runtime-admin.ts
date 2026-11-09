/**
 * The runtime's admin (designs/2026-11-09-own-runtime.md): Restate's admin SQL dialect
 * (`sys_invocation`, `sys_journal`, ...) on the pg runtime's `rt_admin` views, and
 * `PATCH /invocations/<id>/<resume|kill|cancel>` on rt rows.
 */
import type { Db } from "@wren/db";
import { rtAdmin, rtPatch } from "@wren/runtime/pg";
import { LOOPS_SQL, loopsOf } from "./loops.js";

/** One admin SQL query: its rows. */
export type AdminQuery = (query: string) => Promise<Record<string, unknown>[]>;

/** A resume, kill or cancel: `/invocations/<id>/resume?deployment=latest`. */
export type AdminPatch = (path: string) => Promise<void>;

export function runtimeAdmin(db: Db): { query: AdminQuery; patch: AdminPatch } {
  const patch = rtPatch(db.$client);
  return {
    query: rtAdmin(db.$client),
    patch: async (path) => {
      if (!(await patch(path))) throw new Error(`no runtime row for ${path}`);
    },
  };
}

/** The services with a loop object running: the Shop's "Off" for a part whose loops all stopped. */
export const runningLoops = (admin: AdminQuery) => async (): Promise<ReadonlySet<string>> =>
  new Set(
    loopsOf(await admin(LOOPS_SQL))
      .filter((l) => l.running)
      .map((l) => l.service),
  );
