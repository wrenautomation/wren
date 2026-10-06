/**
 * A pass's units in batches: up to `perRun` units share one `ctx.run`, so a pass of
 * 50 companies journals 3 steps, not 50. A unit that throws ends its batch there
 * (the units before it stay journaled), then runs alone under `retry`, as every unit
 * did before, and yields `ok: false` once its retries are spent. A crash mid-batch
 * re-runs that batch's finished units, so only free, idempotent work batches: a unit
 * that buys a model call or a metered read keeps `perRun: 1` and is never bought twice.
 */
import * as restate from "@restatedev/restate-sdk";
import { hold, holdsOn, settle } from "@wren/core/checks";
import type { Queryable } from "@wren/db";

/** Units per journaled step for free work. */
export const UNITS_PER_RUN = 20;

export type UnitResult<I, T> = { id: I; ok: true; value: T } | { id: I; ok: false; reason: string };

type RunCtx = Pick<restate.Context, "run">;

/**
 * A stage's holds for one run (`@wren/core/checks`): `held` units are left out of the run, a
 * unit out of retries is held, and a `due` unit that lands settles its hold.
 */
export interface StageHolds {
  db: Queryable;
  stage: string;
  held: ReadonlySet<string>;
  due: ReadonlySet<string>;
}

export async function stageHolds(ctx: RunCtx, db: Queryable, stage: string): Promise<StageHolds> {
  const h = await ctx.run(`holds ${stage}`, () => holdsOn(db, stage));
  return { db, stage, held: new Set(h.held), due: new Set(h.due) };
}

/** The ids not held, in their order. */
export const notHeld = <I>(h: StageHolds, ids: readonly I[]): I[] =>
  ids.filter((id) => !h.held.has(String(id)));

/** Run inside the unit's step: a held unit that landed is let go. */
export async function landed(h: StageHolds | undefined, id: unknown): Promise<void> {
  if (h?.due.has(String(id))) await settle(h.db, h.stage, [String(id)]);
}

/** A unit out of retries: held 7 days, or until a person releases it after its one retry. */
export function holdFailed(ctx: RunCtx, h: StageHolds, id: unknown, reason: string) {
  return ctx.run(`hold ${h.stage} ${String(id)}`, () =>
    hold(h.db, { stage: h.stage, subject: String(id), reason, spent: true }),
  );
}

export async function* unitBatches<I, T>(
  ctx: RunCtx,
  name: string,
  ids: readonly I[],
  fn: (id: I) => Promise<T>,
  opts: { perRun?: number; retry?: restate.RunOptions<T>; holds?: StageHolds } = {},
): AsyncGenerator<UnitResult<I, T>> {
  const perRun = Math.max(1, opts.perRun ?? UNITS_PER_RUN);
  const h = opts.holds;
  const unit = async (id: I) => {
    const value = await fn(id);
    await landed(h, id);
    return value;
  };
  let i = 0;
  while (i < ids.length) {
    const chunk = ids.slice(i, i + perRun);
    if (chunk.length > 1) {
      const done = await ctx.run(`${name} ${String(chunk[0])} +${chunk.length - 1}`, async () => {
        const values: T[] = [];
        for (const id of chunk) {
          try {
            values.push(await unit(id));
          } catch {
            return { values, failed: true };
          }
        }
        return { values, failed: false };
      });
      for (const value of done.values) yield { id: ids[i++] as I, ok: true, value };
      if (!done.failed) continue;
    }
    // One unit alone: a batch of one, or the unit a batch failed on.
    const id = ids[i++] as I;
    try {
      const value = await ctx.run(`${name} ${String(id)}`, () => unit(id), opts.retry ?? {});
      yield { id, ok: true, value };
    } catch (err) {
      if (!(err instanceof restate.TerminalError)) throw err;
      if (h) await holdFailed(ctx, h, id, err.message);
      yield { id, ok: false, reason: err.message };
    }
  }
}
