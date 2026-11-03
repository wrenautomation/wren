/**
 * Outbound's answer to the turn stores' ports (`TurnDeps`): its kinds with the Reddit floors, its
 * accounts' comment counts, his comment decisions as examples, the handles passed on, the karma
 * check on our answers, and who a Reddit person is. The worker passes it where a turn function
 * asks (R3); until then outbound's own callers and records do.
 */
import type { Queryable } from "@wren/db";
import type { TurnDeps } from "@wren/starling-conversations";
import { inArray } from "drizzle-orm";
import { personLine } from "./discovery/people.js";
import { commentsToday } from "./discovery/threads.js";
import { COMMENT_KINDS_LEARNED, examplesFor } from "./examples.js";
import { reachKinds } from "./item-kinds.js";
import { passedOn } from "./passes.js";
import { redditPeople } from "./schema.js";
import { karmaAnswer } from "./touches.js";

/** One line per read Reddit person; a platform we do not read yields none. */
async function about(
  db: Queryable,
  platform: string,
  handles: readonly string[],
): Promise<Map<string, string | null>> {
  if (platform !== "reddit" || !handles.length) return new Map();
  const rows = await db
    .select()
    .from(redditPeople)
    .where(inArray(redditPeople.handle, [...handles]));
  return new Map(rows.map((p) => [p.handle, personLine(p)]));
}

export const reachTurns: TurnDeps = {
  kinds: reachKinds,
  commentsToday,
  examplesFor: (db, about) => examplesFor(db, COMMENT_KINDS_LEARNED, about),
  passedOn,
  warmupAnswer: karmaAnswer,
  about,
};
