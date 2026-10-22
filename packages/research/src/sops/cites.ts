/**
 * Citations as numbers. The build and the points files cite `[youtube-abc123 1:02]`; the SOP
 * keeps `[1 1:02]` and one `## Sources` list at the bottom, so a long stem is written once.
 * `numberCites` and `expandCites` are inverses: the build feeds the model the long form.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const HEADING = "\n## Sources\n";
const AT = String.raw`((?: (?:\d{1,2}:\d{2}(?::\d{2})?(?:, \d{1,2}:\d{2}(?::\d{2})?)*|caption))?)`;
const LONG = new RegExp(String.raw`\[([a-z]+-[A-Za-z0-9_-]+)${AT}\]`, "g");
const SHORT = new RegExp(String.raw`\[(\d+)${AT}\]`, "g");

const field = (raw: string, key: string) =>
  raw.match(new RegExp(`^${key}:\\s*"?(.*?)"?\\s*$`, "m"))?.[1] ?? "";

/** The SOP body and the stem each footnote number stands for. */
function split(md: string): { body: string; stems: Map<number, string> } {
  const at = md.lastIndexOf(HEADING);
  const stems = new Map<number, string>();
  if (at < 0) return { body: md, stems };
  for (const m of md.slice(at).matchAll(/^(\d+)\. ([a-z]+-[A-Za-z0-9_-]+)(?=,|$)/gm))
    stems.set(Number(m[1]), m[2] as string);
  return { body: md.slice(0, at), stems };
}

/** Long cites to `[n ts]` plus the Sources list. Only stems with a file in sources/ count. */
export async function numberCites(dir: string, md: string): Promise<string> {
  const files = await readdir(join(dir, "sources")).catch(() => [] as string[]);
  const known = new Set(files.filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")));
  const { body, stems } = split(md);
  const number = new Map([...stems].map(([n, s]) => [s, n]));
  const used = new Set<number>();
  // A model can drop a trailing "-" from a stem; one known stem that starts with it is the match.
  const resolve = (s: string) =>
    known.has(s)
      ? s
      : [...known].filter((k) => k.startsWith(s) && /^-+$/.test(k.slice(s.length))).at(0);
  const out = body.replace(LONG, (all, cited: string, at: string) => {
    const stem = resolve(cited);
    if (!stem) return all;
    let n = number.get(stem);
    if (!n) {
      n = Math.max(0, ...stems.keys()) + 1;
      stems.set(n, stem);
      number.set(stem, n);
    }
    used.add(n);
    return `[${n}${at}]`;
  });
  for (const m of out.matchAll(SHORT)) used.add(Number(m[1]));
  if (!used.size) return out;
  const lines: string[] = [];
  for (const n of [...used].sort((a, b) => a - b)) {
    const stem = stems.get(n);
    if (!stem) continue;
    const raw = await readFile(join(dir, "sources", `${stem}.md`), "utf8").catch(() => "");
    const [title, by, url] = [field(raw, "title"), field(raw, "channel"), field(raw, "url")];
    lines.push(`${n}. ${[stem, title && `"${title}"`, by, url].filter(Boolean).join(", ")}`);
  }
  return `${out.trimEnd()}\n${HEADING}\n${lines.join("\n")}\n`;
}

/** `[n ts]` back to the long form and the Sources list dropped; what the build model reads. */
export function expandCites(md: string): string {
  const { body, stems } = split(md);
  if (!stems.size) return md;
  return body
    .replace(SHORT, (all, n: string, at: string) => {
      const stem = stems.get(Number(n));
      return stem ? `[${stem}${at}]` : all;
    })
    .trimEnd()
    .concat("\n");
}
