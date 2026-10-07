/**
 * Compare two versions word by word, each change credited to the version that made it. Pure, no
 * imports: the web and the server share it.
 */

/** Words, spaces and punctuation, each its own token. */
export const tokens = (s: string): string[] => s.match(/\s+|[\p{L}\p{N}_'’-]+|[^\s]/gu) ?? [];

export type Op = "same" | "ins" | "del";

/**
 * The shortest edit from `a` to `b` (Myers): each token kept, removed or added. Past `maxD`
 * changes the middle is all removed, then all added.
 */
export function diffTokens(a: readonly string[], b: readonly string[], maxD = 4000): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const mid = middle(a.slice(start, endA), b.slice(start, endB), maxD);
  return [...Array<Op>(start).fill("same"), ...mid, ...Array<Op>(a.length - endA).fill("same")];
}

function middle(a: readonly string[], b: readonly string[], maxD: number): Op[] {
  const n = a.length;
  const m = b.length;
  if (!n) return Array<Op>(m).fill("ins");
  if (!m) return Array<Op>(n).fill("del");
  const max = Math.min(n + m, maxD);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v[off + k - 1] as number) < (v[off + k + 1] as number))
          ? (v[off + k + 1] as number)
          : (v[off + k - 1] as number) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return [...Array<Op>(n).fill("del"), ...Array<Op>(m).fill("ins")];
  // Walk back through the trace.
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const vd = trace[d] as Int32Array;
    const k = x - y;
    const down = k === -d || (k !== d && (vd[off + k - 1] as number) < (vd[off + k + 1] as number));
    const pk = down ? k + 1 : k - 1;
    const px = vd[off + pk] as number;
    const py = px - pk;
    // The snake ran from just after the edit to (x, y).
    const sx = down ? px : px + 1;
    const sy = down ? py + 1 : py;
    while (x > sx && y > sy) {
      ops.push("same");
      x--;
      y--;
    }
    ops.push(down ? "ins" : "del");
    x = px;
    y = py;
  }
  while (x > 0 && y > 0) {
    ops.push("same");
    x--;
    y--;
  }
  return ops.reverse();
}

/** A run of words: kept, added or removed, and by which version. */
export interface Piece {
  op: Op;
  text: string;
  /** The version that added (`ins`) or removed (`del`) it; null for `same`. */
  by: number | null;
}

interface Tok {
  t: string;
  ins: number | null;
  del: number | null;
}

/**
 * From `base` through each step in order: what's left of `base`, every word added since with the
 * step that added it, and every word of `base` removed with the step that removed it. A word
 * added then removed between the two shows nowhere.
 */
export function blame(base: string, steps: readonly { number: number; text: string }[]): Piece[] {
  let state: Tok[] = tokens(base).map((t) => ({ t, ins: null, del: null }));
  for (const s of steps) {
    const live = state.filter((x) => x.del === null);
    const next = tokens(s.text);
    const ops = diffTokens(
      live.map((x) => x.t),
      next,
    );
    const out: Tok[] = [];
    let at = 0;
    let j = 0;
    const toLive = () => {
      while (at < state.length && (state[at] as Tok).del !== null) out.push(state[at++] as Tok);
      return state[at++] as Tok;
    };
    for (const op of ops) {
      if (op === "ins") out.push({ t: next[j++] as string, ins: s.number, del: null });
      else {
        const tok = toLive();
        if (op === "same") {
          out.push(tok);
          j++;
        } else if (tok.ins === null) out.push({ ...tok, del: s.number });
      }
    }
    while (at < state.length) out.push(state[at++] as Tok);
    state = out;
  }
  const pieces: Piece[] = [];
  for (const x of state) {
    const op: Op = x.del !== null ? "del" : x.ins !== null ? "ins" : "same";
    const by = op === "del" ? x.del : op === "ins" ? x.ins : null;
    const last = pieces.at(-1);
    if (last && last.op === op && last.by === by) last.text += x.t;
    else pieces.push({ op, text: x.t, by });
  }
  return pieces;
}

/** Words added and removed, for a version's line in the timeline. */
export function counts(pieces: readonly Piece[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const p of pieces) {
    const words = (p.text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
    if (p.op === "ins") added += words;
    if (p.op === "del") removed += words;
  }
  return { added, removed };
}
