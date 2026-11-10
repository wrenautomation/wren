/**
 * `wren video marks|mark|done|unmark` (designs/2026-11-10-video-editor-pick.md, marks): notes pinned
 * to a moment, a range or a part of the picture. The same calls as Finish's Marks panel, so the
 * agent reads and closes what he marked. JSON out.
 */

import type { Db } from "@wren/db";
import { addMark, closeMarks, dropMark, marksOf, restoreMark } from "@wren/starling-studio/marks";
import { FORMATS, MARK_TONES } from "@wren/starling-studio/schema";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const idOf = (v: string, what = "video") => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`not a ${what} id: ${v}`);
  return n;
};

/** `12.5` or `12.5-14`, raw seconds. */
export function spanOf(v: string): { start: number; end: number | null } {
  const m = /^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$/.exec(v.trim());
  if (!m) throw new Error(`--at takes seconds, or from-to: ${v}`);
  return { start: Number(m[1]), end: m[2] === undefined ? null : Number(m[2]) };
}

/** `x,y,w,h`, fractions of the frame. */
export function boxOf(v: string): { x: number; y: number; w: number; h: number } {
  const n = v.split(",").map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x)))
    throw new Error(`--box takes x,y,w,h as fractions of the frame: ${v}`);
  const [x, y, w, h] = n as [number, number, number, number];
  return { x, y, w, h };
}

const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));

export function registerVideoMarks(video: Command, withDb: WithDb): void {
  video
    .command("marks <id>")
    .description("the open marks in time order (--all: closed ones too), as JSON")
    .option("--all", "closed marks too, with who closed each and why")
    .action((v: string, o: { all?: boolean }) =>
      withDb(async (db) => out(await marksOf(db, idOf(v), { open: !o.all }))),
    );

  video
    .command("mark <id> <text>")
    .description(
      "pin a note to a moment (--at s), a range (--at s-e) or a part of the picture (--box)",
    )
    .requiredOption("--at <s[-e]>", "raw seconds, or from-to")
    .option("--box <x,y,w,h>", "a part of the picture, fractions of the frame")
    .option("--format <f>", `the shape the box is on: ${FORMATS.join(", ")}`, "long")
    .option("--tone <t>", `${MARK_TONES.join(" or ")}: a thing to keep, or to fix`)
    .option("--by <who>", "who marked it", "cli")
    .action(
      (
        v: string,
        text: string,
        o: { at: string; box?: string; format: string; tone?: string; by: string },
      ) =>
        withDb(async (db) =>
          out(
            await addMark(
              db,
              idOf(v),
              {
                ...spanOf(o.at),
                box: o.box ? boxOf(o.box) : null,
                format: o.format as (typeof FORMATS)[number],
                tone: (o.tone ?? null) as (typeof MARK_TONES)[number] | null,
                text,
              },
              o.by,
            ),
          ),
        ),
    );

  video
    .command("done <id> <mark>")
    .description("close a mark with what was done")
    .requiredOption("--why <sentence>", "what you changed, or why you did not")
    .option("--by <who>", "who closed it (an agent: its session id)", "cli")
    .option("--run <run>", "the run that made the change")
    .action((v: string, m: string, o: { why: string; by: string; run?: string }) =>
      withDb(async (db) => {
        const r = await closeMarks(db, idOf(v), [{ id: idOf(m, "mark"), why: o.why }], {
          by: o.by,
          run: o.run ?? null,
        });
        if (!r.closed.length) throw new Error(`mark ${m} is closed already, or not on video ${v}`);
        out(r);
      }),
    );

  video
    .command("unmark <id> <mark>")
    .description("take a mark back, open or closed (the row stays); --undo puts it back")
    .option("--undo", "put a removed mark back as it was")
    .option("--by <who>", "who removed it", "cli")
    .action((v: string, m: string, o: { undo?: boolean; by: string }) =>
      withDb(async (db) => {
        const mark = idOf(m, "mark");
        const moved = o.undo
          ? await restoreMark(db, idOf(v), mark)
          : await dropMark(db, idOf(v), mark, o.by);
        if (!moved)
          throw new Error(
            o.undo ? `mark ${m} isn't removed from video ${v}` : `mark ${m} isn't on video ${v}`,
          );
        out(o.undo ? { restored: mark } : { removed: mark });
      }),
    );
}
