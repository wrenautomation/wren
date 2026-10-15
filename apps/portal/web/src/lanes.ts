/**
 * One record's calls run in the order made: words saved as a box lost focus land before the
 * Approve that took it. The same call again while the first runs (a double click, a key held)
 * answers with the first, never runs twice. A file is never matched, so two uploads both go.
 */
type Input = Record<string, unknown>;

/** The call each record last started, and each call still running, by what it sends. */
const lanes = new Map<string, Promise<unknown>>();
const flying = new Map<string, Promise<unknown>>();

/** Run `run` after the calls before it on the same records; `keyOf` names a record from its id. */
export function inLane<T>(
  handler: string,
  input: Input,
  keyOf: (id: string) => string,
  run: () => Promise<T>,
): Promise<T> {
  const ids = Array.isArray(input.ids) ? input.ids.map((id) => keyOf(String(id))) : [];
  const same = Object.values(input).some((v) => typeof Blob !== "undefined" && v instanceof Blob)
    ? null
    : `${handler} ${JSON.stringify(input)}`;
  const twin = same ? flying.get(same) : undefined;
  if (twin) return twin as Promise<T>;
  const before = ids.flatMap((id) => lanes.get(id) ?? []);
  const p = Promise.allSettled(before).then(run);
  const done = () => {
    if (same && flying.get(same) === p) flying.delete(same);
    for (const id of ids) if (lanes.get(id) === p) lanes.delete(id);
  };
  p.then(done, done);
  if (same) flying.set(same, p);
  for (const id of ids) lanes.set(id, p);
  return p;
}
