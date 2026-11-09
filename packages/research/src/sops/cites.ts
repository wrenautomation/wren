/**
 * Citations as numbers. The build and the points cite `[youtube-abc123 1:02]`; a guide keeps
 * `[1 1:02]`, where 1 is the first id in its `cites` (`knowledge render` adds the Sources list).
 * `numberCites` and `expandCites` are inverses: the build feeds the model the long form.
 */

const AT = String.raw`((?: (?:\d{1,2}:\d{2}(?::\d{2})?(?:, \d{1,2}:\d{2}(?::\d{2})?)*|caption))?)`;
const LONG = new RegExp(String.raw`\[([a-z]+-[A-Za-z0-9_-]+)${AT}\]`, "g");
const SHORT = new RegExp(String.raw`\[(\d+)${AT}\]`, "g");
const HEADING = "\n## Sources\n";

/** A body the model ended with its own `## Sources` list: the body, and the stem each number meant. */
function split(md: string, prior: string[]): { body: string; stems: Map<number, string> } {
  const stems = new Map(prior.map((s, i) => [i + 1, s]));
  const at = md.lastIndexOf(HEADING);
  if (at < 0) return { body: md, stems };
  for (const m of md.slice(at).matchAll(/^(\d+)\. ([a-z]+-[A-Za-z0-9_-]+)(?=,|$)/gm))
    stems.set(Number(m[1]), m[2] as string);
  return { body: md.slice(0, at), stems };
}

/**
 * Long cites to `[n ts]`, numbered by first use after the ones `prior` holds. Only stems in `known`
 * count; a number that names no source is dropped (the lint refuses it). `cites` is dense: n is its place.
 */
export function numberCites(
  md: string,
  prior: string[],
  known: ReadonlySet<string>,
): { body: string; cites: string[] } {
  const { body, stems } = split(md, prior);
  const number = new Map([...stems].map(([n, s]) => [s, n]));
  // A model can drop a trailing "-" from a stem; one known stem that starts with it is the match.
  const resolve = (s: string) =>
    known.has(s)
      ? s
      : [...known].filter((k) => k.startsWith(s) && /^-+$/.test(k.slice(s.length))).at(0);
  let next = Math.max(0, ...stems.keys());
  const long = body.replace(LONG, (all, cited: string, at: string) => {
    const stem = resolve(cited);
    if (!stem) return all;
    let n = number.get(stem);
    if (!n) {
      n = ++next;
      stems.set(n, stem);
      number.set(stem, n);
    }
    return `[${n}${at}]`;
  });
  const used = [...new Set([...long.matchAll(SHORT)].map((m) => Number(m[1])))]
    .filter((n) => known.has(stems.get(n) ?? ""))
    .sort((a, b) => a - b);
  const place = new Map(used.map((n, i) => [n, i + 1]));
  const out = long.replace(SHORT, (_all, n: string, at: string) => {
    const p = place.get(Number(n));
    return p ? `[${p}${at}]` : "";
  });
  return { body: `${out.trimEnd()}\n`, cites: used.map((n) => stems.get(n) as string) };
}

/** `[n ts]` back to the long form; what the build model reads. */
export function expandCites(body: string, cites: string[]): string {
  return body.replace(SHORT, (all, n: string, at: string) => {
    const stem = cites[Number(n) - 1];
    return stem ? `[${stem}${at}]` : all;
  });
}
