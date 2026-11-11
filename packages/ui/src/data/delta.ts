/**
 * A list read that asks only for what changed (`@wren/core/records/delta`): it sends the hashes
 * of the rows it already holds and fills the stubs that come back from them. A stub it can't
 * fill reads the list again in full.
 */
import { knownOf, mergeChanged } from "@wren/core/records/delta";
import type { ListAsk, RowsPage } from "@wren/core/records/serve";

export async function listChanged<P extends RowsPage>(
  list: (ask: ListAsk) => Promise<P>,
  ask: ListAsk,
  before: P | undefined,
): Promise<P> {
  const known = before?.record === ask.record ? knownOf(before) : [];
  if (!known.length) return list(ask);
  const got = await list({ ...ask, known });
  return mergeChanged(got, before) ?? list(ask);
}
