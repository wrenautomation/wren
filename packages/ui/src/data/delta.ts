/**
 * A list read that asks only for what changed (`@wren/core/records/delta`): it sends the hashes
 * of the rows it already holds and fills the stubs that come back from them. A stub it can't
 * fill reads the list again in full.
 */
import { knownOf, mergeChanged } from "@wren/core/records/delta";
import type { ListAsk, RecordsPage } from "@wren/core/records/serve";

export async function listChanged(
  list: (ask: ListAsk) => Promise<RecordsPage>,
  ask: ListAsk,
  before: RecordsPage | undefined,
): Promise<RecordsPage> {
  const known = before?.record === ask.record ? knownOf(before) : [];
  if (!known.length) return list(ask);
  const got = await list({ ...ask, known });
  return mergeChanged(got, before) ?? list(ask);
}
