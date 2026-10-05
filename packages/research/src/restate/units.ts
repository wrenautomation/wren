/**
 * A pass's units in batches: up to `perRun` units share one `ctx.run`, so a pass of
 * 50 companies journals 3 steps, not 50. A unit that throws ends its batch there
 * (the units before it stay journaled), then runs alone under `retry`, as every unit
 * did before, and yields `ok: false` once its retries are spent. A crash mid-batch
 * re-runs that batch's finished units, so only free, idempotent work batches: a unit
 * that buys a model call or a metered read keeps `perRun: 1` and is never bought twice.
 */
import * as restate from "@restatedev/restate-sdk";

/** Units per journaled step for free work. */
export const UNITS_PER_RUN = 20;

export type UnitResult<I, T> = { id: I; ok: true; value: T } | { id: I; ok: false; reason: string };

type RunCtx = Pick<restate.Context, "run">;

export async function* unitBatches<I, T>(
  ctx: RunCtx,
  name: string,
  ids: readonly I[],
  fn: (id: I) => Promise<T>,
  opts: { perRun?: number; retry?: restate.RunOptions<T> } = {},
): AsyncGenerator<UnitResult<I, T>> {
  const perRun = Math.max(1, opts.perRun ?? UNITS_PER_RUN);
  let i = 0;
  while (i < ids.length) {
    const chunk = ids.slice(i, i + perRun);
    if (chunk.length > 1) {
      const done = await ctx.run(`${name} ${String(chunk[0])} +${chunk.length - 1}`, async () => {
        const values: T[] = [];
        for (const id of chunk) {
          try {
            values.push(await fn(id));
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
      const value = await ctx.run(`${name} ${String(id)}`, () => fn(id), opts.retry ?? {});
      yield { id, ok: true, value };
    } catch (err) {
      if (!(err instanceof restate.TerminalError)) throw err;
      yield { id, ok: false, reason: err.message };
    }
  }
}
