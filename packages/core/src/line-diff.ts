/**
 * Two texts compared line by line (longest common subsequence): what the CLI's `templates diff`
 * prints and the Library's diff draws. Pure, no imports, so the browser bundle takes it as is.
 */

/** One line of a diff: in both (" "), only in a ("-"), only in b ("+"). Numbers are 1-based. */
export interface DiffLine {
  op: " " | "-" | "+";
  text: string;
  a: number | null;
  b: number | null;
}

/** Past this many cells the middle is shown as all removed then all added. */
const MAX_CELLS = 4_000_000;

export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a === "" ? [] : a.split("\n");
  const y = b === "" ? [] : b.split("\n");
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--;
    endY--;
  }
  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ op: " ", text: x[i] as string, a: i + 1, b: i + 1 });
  const n = endX - start;
  const m = endY - start;
  if (n * m > MAX_CELLS) {
    for (let i = start; i < endX; i++)
      out.push({ op: "-", text: x[i] as string, a: i + 1, b: null });
    for (let j = start; j < endY; j++)
      out.push({ op: "+", text: y[j] as string, a: null, b: j + 1 });
  } else {
    // lcs[i][j]: the longest common run of x[start+i..] and y[start+j..].
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lcs[i * w + j] =
          x[start + i] === y[start + j]
            ? (lcs[(i + 1) * w + j + 1] as number) + 1
            : Math.max(lcs[(i + 1) * w + j] as number, lcs[i * w + j + 1] as number);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && x[start + i] === y[start + j]) {
        out.push({ op: " ", text: x[start + i] as string, a: start + i + 1, b: start + j + 1 });
        i++;
        j++;
      } else if (
        j < m &&
        (i === n || (lcs[i * w + j + 1] as number) >= (lcs[(i + 1) * w + j] as number))
      ) {
        out.push({ op: "+", text: y[start + j] as string, a: null, b: start + j + 1 });
        j++;
      } else {
        out.push({ op: "-", text: x[start + i] as string, a: start + i + 1, b: null });
        i++;
      }
    }
  }
  for (let k = 0; k < x.length - endX; k++)
    out.push({ op: " ", text: x[endX + k] as string, a: endX + k + 1, b: endY + k + 1 });
  // Removals before additions within one changed run reads best.
  return tidy(out);
}

/** Within each run of changes, removed lines first, then added. */
function tidy(lines: DiffLine[]): DiffLine[] {
  const out: DiffLine[] = [];
  let run: DiffLine[] = [];
  const flush = () => {
    out.push(...run.filter((l) => l.op === "-"), ...run.filter((l) => l.op === "+"));
    run = [];
  };
  for (const l of lines) {
    if (l.op === " ") {
      flush();
      out.push(l);
    } else run.push(l);
  }
  flush();
  return out;
}

/** Whether two texts differ at all, by the diff. */
export const changed = (lines: readonly DiffLine[]) => lines.some((l) => l.op !== " ");

/**
 * A unified diff as text: `--- a`, `+++ b`, then hunks with `context` lines around each change.
 * Empty when nothing changed.
 */
export function unified(lines: readonly DiffLine[], names: [string, string], context = 3): string {
  if (!changed(lines)) return "";
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.op === " ") return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++)
      keep[k] = true;
  });
  const out = [`--- ${names[0]}`, `+++ ${names[1]}`];
  let i = 0;
  while (i < lines.length) {
    if (!keep[i]) {
      i++;
      continue;
    }
    let end = i;
    while (end < lines.length && keep[end]) end++;
    const hunk = lines.slice(i, end);
    const aStart = hunk.find((l) => l.a !== null)?.a ?? 0;
    const bStart = hunk.find((l) => l.b !== null)?.b ?? 0;
    const aLen = hunk.filter((l) => l.op !== "+").length;
    const bLen = hunk.filter((l) => l.op !== "-").length;
    out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (const l of hunk) out.push(`${l.op}${l.text}`);
    i = end;
  }
  return out.join("\n");
}
