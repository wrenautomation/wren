/**
 * The quality floor's gate (designs/2026-11-10-studio-quality-floor.md): Approve and the Short
 * swap post an output only when its newest check is on its current render and finds no P0 or
 * P1. A P1 passes with a reason, kept on a `video override` run. A P0 never ships.
 */
import { finishRun, openRun } from "@wren/core";
import type { Queryable } from "@wren/db";
import { FLOOR_VERSION, VIDEO_CHECK } from "@wren/starling-studio/bar";
import { CROPPED } from "@wren/starling-studio/finish";
import { hashKey } from "@wren/starling-studio/hash";
import type { VideoEdit } from "@wren/starling-studio/schema";
import { sql } from "drizzle-orm";

interface GateIssue {
  rank: string;
  rule: string;
  at: number;
  says: string;
}
/** An output's newest finished check run. */
interface OutputCheck {
  hash: string | null;
  floor: number | null;
  issues: GateIssue[];
}

/** What an Approve posts: the long file, Short n, or the vertical plus each framed render uploaded beside it. */
export function postedOutputs(
  e: Pick<VideoEdit, "keys">,
  reels: number | "vertical" | undefined,
): string[] {
  if (reels === undefined) return ["long"];
  if (typeof reels === "number") return [`short-${reels}`];
  return ["vertical", ...CROPPED.filter((f) => f !== "vertical" && e.keys[`reel-${f}`])];
}

/** Each output's newest finished `video check` run, by query (the step list is capped). */
async function latestChecks(
  db: Queryable,
  id: number,
  outputs: readonly string[],
): Promise<Map<string, OutputCheck>> {
  if (!outputs.length) return new Map();
  // Keyed on argv: a run that threw keeps only `{ error }` in stats, and must read as unchecked.
  const rows = (await db.execute(sql`
    SELECT DISTINCT ON (argv->>'output') argv->>'output' AS output, stats
    FROM runs
    WHERE command = ${VIDEO_CHECK} AND argv->>'id' = ${String(id)}
      AND finished_at IS NOT NULL
      AND argv->>'output' IN (${sql.join(
        outputs.map((o) => sql`${o}`),
        sql`, `,
      )})
    ORDER BY argv->>'output', started_at DESC, id DESC`)) as unknown as {
    output: string;
    stats: Record<string, unknown> | null;
  }[];
  return new Map(
    rows.map(({ output, stats }) => {
      const s = stats ?? {};
      const ok = typeof s.error !== "string";
      return [
        output,
        {
          hash: ok && typeof s.hash === "string" ? s.hash : null,
          floor: typeof s.floor === "number" ? s.floor : null,
          issues: ok && Array.isArray(s.issues) ? (s.issues as GateIssue[]) : [],
        },
      ];
    }),
  );
}

type GateVerdict =
  | { ok: true; overridden: (GateIssue & { output: string })[] }
  | { ok: false; why: string };

const NAMES: Record<string, string> = {
  long: "The long video",
  vertical: "The vertical cut",
  square: "The square cut",
  portrait: "The portrait cut",
};
const nameOf = (o: string) => NAMES[o] ?? `Short ${o.replace("short-", "")}`;
const listed = (issues: GateIssue[]) =>
  issues.map((i) => `at ${i.at.toFixed(1)} s, ${i.says}`).join("; ");

/** A check counts only on the render it looked at, under the current floor rules. */
export const onThisRender = (
  files: Record<string, string>,
  output: string,
  c: { hash: string | null; floor: number | null } | undefined,
) =>
  Boolean(c && c.hash !== null && c.hash === (files[hashKey(output)] ?? null)) &&
  (c?.floor ?? 0) >= FLOOR_VERSION;

/**
 * The gate on `outputs` of a video: unchecked (no run, a stale hash, an older floor) refuses; a
 * P0 refuses; a P1 refuses unless `override` gives a reason.
 */
function gate(
  id: number,
  files: Record<string, string>,
  outputs: readonly string[],
  checks: ReadonlyMap<string, OutputCheck>,
  override?: string,
): GateVerdict {
  const unchecked = outputs.filter((o) => !onThisRender(files, o, checks.get(o)));
  if (unchecked.length)
    return {
      ok: false,
      why: `Check it first: wren video check ${id} (not checked on this render: ${unchecked.map(nameOf).join(", ")}).`,
    };
  const ranked = (rank: string) =>
    outputs.flatMap((o) =>
      (checks.get(o)?.issues ?? [])
        .filter((i) => i.rank === rank)
        .map((i) => ({ ...i, output: o })),
    );
  const p0 = ranked("P0");
  if (p0.length)
    return {
      ok: false,
      why: `${nameOf(p0[0]?.output ?? "")} can't ship: ${listed(p0)}. Fix it and render again.`,
    };
  const p1 = ranked("P1");
  if (p1.length && !override?.trim())
    return {
      ok: false,
      why: `${nameOf(p1[0]?.output ?? "")} has faults a viewer sees: ${listed(p1)}. Fix them, or approve with a reason (--override "<reason>").`,
    };
  return { ok: true, overridden: p1 };
}

/** Check `outputs`, throw when the gate refuses, and keep an override's reason on its own run. */
export async function passGate(
  db: Queryable,
  e: Pick<VideoEdit, "id" | "files">,
  outputs: readonly string[],
  o: { override?: string | undefined; by: string },
): Promise<void> {
  const v = gate(e.id, e.files, outputs, await latestChecks(db, e.id, outputs), o.override);
  if (!v.ok) throw new Error(v.why);
  if (!v.overridden.length) return;
  const { id: run } = await openRun(db, {
    command: "video override",
    argv: { id: e.id, outputs, by: o.by, reason: o.override?.trim() ?? "" },
  });
  await finishRun(db, run, { overridden: v.overridden });
}
