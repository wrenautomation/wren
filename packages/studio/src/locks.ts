/**
 * Locks (designs/2026-10-24-video-film-file.md, Decision 1): the parts of an edit a person set by
 * hand, which the agent must keep. A lock is a field path: `cuts`, `shorts.2` (Short 2), `crops.vertical`,
 * `captions.place`. List items count from 1, as the page and the CLI name them. A person's save on the
 * page locks what it changed; the agent's patch (`video ask`, the edit pass) is refused where it
 * would change a locked part.
 */
const PATH = /^[a-zA-Z]+(\.[a-zA-Z0-9]+)*$/;
export const isLockPath = (p: string) => PATH.test(p);

/** The value at `path` in `edit` (list items from 1); undefined when there is none. */
export function valueAt(edit: object, path: string): unknown {
  let at: unknown = edit;
  for (const part of path.split(".")) {
    if (at === null || typeof at !== "object") return undefined;
    at = Array.isArray(at) ? at[Number(part) - 1] : (at as Record<string, unknown>)[part];
  }
  return at;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * What a change from `before` to `after` touched, one level into each field: the list items that
 * moved when the list kept its length, the keys of an object that moved, else the whole field.
 */
export function changedPaths(before: object, after: object, fields: readonly string[]): string[] {
  return fields.flatMap((f) => {
    const a = valueAt(before, f);
    const b = valueAt(after, f);
    if (same(a, b)) return [];
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length)
      return a.flatMap((x, i) => (same(x, b[i]) ? [] : [`${f}.${i + 1}`]));
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b as object)]);
      return [...keys]
        .filter((k) => !same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
        .map((k) => `${f}.${k}`);
    }
    return [f];
  });
}

/** `locked` with `paths` added, each once; a path under a locked one adds nothing. */
export function withLocks(locked: readonly string[], paths: readonly string[]): string[] {
  const out = [...locked];
  for (const p of paths)
    if (!out.some((l) => p === l || p.startsWith(`${l}.`))) {
      const kept = out.filter((l) => !l.startsWith(`${p}.`));
      out.length = 0;
      out.push(...kept, p);
    }
  return out;
}

/** The locked parts a change from `before` to `after` would move (none: it may be written). */
export function brokenLocks(locked: readonly string[], before: object, after: object): string[] {
  return locked.filter((l) => !same(valueAt(before, l), valueAt(after, l)));
}
