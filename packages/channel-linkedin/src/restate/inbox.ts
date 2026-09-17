import * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import { ingestNotes, moveToDone, readInbox } from "../inbox.js";
import { addNote } from "../notes.js";

export interface InboxDeps {
  db: Db;
  inboxDir: string;
}

export const INBOX_KEY = "default";

/**
 * Virtual Object keyed by inbox. One key → one writer, so two `ingest` calls
 * serialize instead of racing (this replaces the Python advisory lock).
 * Every I/O step is journaled with ctx.run, so a crash mid-ingest resumes
 * after the last completed step and never inserts a note twice.
 */
export function makeLinkedinInbox(deps: InboxDeps) {
  return restate.object({
    name: "LinkedinInbox",
    handlers: {
      ingest: async (ctx: restate.ObjectContext): Promise<{ ingested: number }> => {
        const found = await ctx.run("read inbox", () => readInbox(deps.inboxDir));
        const ingested = await ingestNotes(found, {
          insert: (note) =>
            ctx.run(`insert ${note.path}`, async () => {
              await addNote(deps.db, note.body, "inbox", note.imagePaths);
            }),
          move: (note) =>
            ctx.run(`move ${note.path}`, () => moveToDone(deps.inboxDir, note), {
              // A move that fails is an operator problem (permissions, disk); retrying won't fix it.
              maxRetryAttempts: 1,
            }),
        });
        return { ingested };
      },
      add: async (ctx: restate.ObjectContext, body: string): Promise<{ id: string }> => {
        const row = await ctx.run("insert note", () => addNote(deps.db, body, "cli"));
        return { id: row.id };
      },
    },
  });
}

export type LinkedinInbox = ReturnType<typeof makeLinkedinInbox>;
