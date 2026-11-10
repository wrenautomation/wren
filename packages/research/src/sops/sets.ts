/**
 * Rule sets inside one build doc. The model reads and writes an SOP as one markdown doc; a rule set
 * is a block in it:
 *
 *   <!-- set offers-rules OF "Rules" -->
 *   - **OF-1** Change one lever per iteration.
 *   - A new line, no id yet.
 *   <!-- /set -->
 *
 * `splitDoc` cuts the blocks out (the guide keeps `<!-- set <id> -->` where each stood) and
 * `mergeDoc` puts them back. `assignIds` gives every top-level list item a fixed id: a kept line
 * keeps its own, a new one takes the next number after `last` (a dropped id is never used again).
 */

export interface SetBlock {
  id: string;
  /** Line id prefix (`OF`); empty on a set the model just made. */
  prefix: string;
  title: string;
  body: string;
}

const OPEN = /^<!-- set ([a-z0-9][a-z0-9-]*)(?: ([A-Z]{2,3}))?(?: "([^"]*)")? -->$/;
const CLOSE = "<!-- /set -->";
const placeholder = (id: string) => `<!-- set ${id} -->`;

export function splitDoc(md: string): { guide: string; sets: SetBlock[] } {
  const guide: string[] = [];
  const sets: SetBlock[] = [];
  let open: (SetBlock & { lines: string[] }) | null = null;
  for (const line of md.split("\n")) {
    const m = OPEN.exec(line.trim());
    if (open) {
      if (m) throw new Error(`set ${m[1]} opens inside set ${open.id}`);
      if (line.trim() === CLOSE) {
        sets.push({ ...open, body: `${open.lines.join("\n").trim()}\n` });
        open = null;
      } else open.lines.push(line);
    } else if (m?.[1] && (m[2] || m[3] !== undefined)) {
      if (sets.some((s) => s.id === m[1])) throw new Error(`set ${m[1]} appears twice`);
      open = { id: m[1], prefix: m[2] ?? "", title: m[3] ?? "", body: "", lines: [] };
      guide.push(placeholder(m[1]));
    } else guide.push(line);
  }
  if (open) throw new Error(`set ${open.id} never closes (${CLOSE})`);
  return { guide: `${guide.join("\n").trim()}\n`, sets };
}

/** The guide with each set back in its place; a set with no place goes before `## Examples`, else last. */
export function mergeDoc(guide: string, sets: SetBlock[]): string {
  const block = (s: SetBlock) =>
    `<!-- set ${s.id} ${s.prefix} ${JSON.stringify(s.title)} -->\n${s.body.trim()}\n${CLOSE}`;
  let out = guide.trim();
  const loose: string[] = [];
  for (const s of sets) {
    if (out.includes(placeholder(s.id))) out = out.replace(placeholder(s.id), () => block(s));
    else loose.push(block(s));
  }
  if (!loose.length) return `${out}\n`;
  const at = out.search(/^## Examples\s*$/m);
  const add = loose.join("\n\n");
  return at < 0 ? `${out}\n\n${add}\n` : `${out.slice(0, at)}${add}\n\n${out.slice(at)}\n`;
}

const ITEM = /^(?:- |\d+\. )(?:\*\*([A-Z]{2,3})-(\d+)\*\* )?/;

export interface Assigned {
  body: string;
  /** Highest number ever given in this set. */
  last: number;
  kept: string[];
  added: string[];
  dropped: string[];
}

/**
 * Give every top-level list item of a set body its id. `before` is the body as stored: its ids
 * that the new body lacks are `dropped`. Throws on an id used twice, one of another prefix, or one
 * the stored body does not hold.
 */
export function assignIds(body: string, prefix: string, last = 0, before = ""): Assigned {
  const idsOf = (md: string) =>
    md
      .split("\n")
      .map((l) => ITEM.exec(l))
      .filter((m): m is RegExpExecArray => Boolean(m?.[1]))
      .map((m) => ({ prefix: m[1] as string, n: Number(m[2]) }));
  const had = idsOf(before).map((i) => `${i.prefix}-${i.n}`);
  const seen = new Set<number>();
  for (const i of idsOf(body)) {
    if (i.prefix !== prefix) throw new Error(`${i.prefix}-${i.n} in a ${prefix} set`);
    if (seen.has(i.n)) throw new Error(`${prefix}-${i.n} appears twice`);
    // only code gives an id: one the stored set lacks is invented or a dropped id reused
    if (!had.includes(`${prefix}-${i.n}`))
      throw new Error(`${prefix}-${i.n} is not a line of the stored set; a new rule carries no id`);
    seen.add(i.n);
  }
  let next = Math.max(last, 0, ...seen, ...idsOf(before).map((i) => i.n));
  const kept: string[] = [];
  const added: string[] = [];
  let fence = false;
  const lines = body.split("\n").map((line) => {
    if (line.startsWith("```")) fence = !fence;
    const m = fence ? null : ITEM.exec(line);
    if (!m) return line;
    if (m[1]) {
      kept.push(`${m[1]}-${m[2]}`);
      return `- ${line.slice(line.indexOf("**"))}`;
    }
    const id = `${prefix}-${++next}`;
    added.push(id);
    return `- **${id}** ${line.slice(m[0].length)}`;
  });
  return {
    body: lines.join("\n"),
    last: next,
    kept,
    added,
    dropped: had.filter((id) => !kept.includes(id)),
  };
}

/** Every line id prefix in use, from rule bodies. */
export function prefixesIn(bodies: string[]): Set<string> {
  const out = new Set<string>();
  for (const b of bodies)
    for (const m of b.matchAll(/^- \*\*([A-Z]{2,3})-\d+\*\*/gm)) out.add(m[1] as string);
  return out;
}

/** A free two-letter prefix for a set: its words' initials first, then letter pairs from its name. */
export function freePrefix(setId: string, used: ReadonlySet<string>): string {
  const words = setId.toUpperCase().split("-").filter(Boolean);
  const letters = words.join("");
  const tries = [
    ...(words.length > 1
      ? [`${words[0]?.[0]}${words.at(-1)?.[0]}`, `${words[0]?.[0]}${words[1]?.[0]}`]
      : []),
    ...[...letters].flatMap((a, i) => [...letters.slice(i + 1)].map((b) => a + b)),
  ];
  const hit = tries.find((p) => /^[A-Z]{2}$/.test(p) && !used.has(p));
  if (!hit) throw new Error(`${setId}: no free line id prefix; name one in the set marker`);
  return hit;
}
