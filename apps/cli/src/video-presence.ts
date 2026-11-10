/**
 * `wren video at|here` (designs/2026-11-10-video-editor-pick.md, agent cursor): an agent says where
 * it is on a video before it reads or changes a part, so Finish draws its cursor. JSON out.
 */

import type { Db } from "@wren/db";
import { presenceOf, sayPresence } from "@wren/starling-studio/presence";
import { PRESENCE_PARTS } from "@wren/starling-studio/schema";
import type { Command } from "commander";
import { spanOf } from "./video-marks.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const idOf = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`not a video id: ${v}`);
  return n;
};
const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));

export function registerVideoPresence(video: Command, withDb: WithDb): void {
  video
    .command("at <id>")
    .description(
      "say where you are on a video (Finish draws your cursor for 2 minutes); --leave when done",
    )
    .requiredOption("--by <who>", "your session id")
    .option("--at <s[-e]>", "the moment or range you are on, raw seconds")
    .option("--part <part>", `the part you work on: ${PRESENCE_PARTS.join(", ")}`)
    .option("--doing <sentence>", "what you do there")
    .option("--leave", "you are done: the cursor goes")
    .action(
      (v: string, o: { by: string; at?: string; part?: string; doing?: string; leave?: boolean }) =>
        withDb(async (db) =>
          out(
            await sayPresence(db, idOf(v), o.by, {
              ...(o.at ? spanOf(o.at) : {}),
              part: (o.part ?? null) as (typeof PRESENCE_PARTS)[number] | null,
              doing: o.doing ?? null,
              gone: !!o.leave,
            }),
          ),
        ),
    );

  video
    .command("here <id>")
    .description("who is on a video now, as JSON")
    .action((v: string) => withDb(async (db) => out(await presenceOf(db, idOf(v)))));
}
