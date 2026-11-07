/**
 * A subject's generation tree, from its feedback view: one node per sample, rows by batch,
 * the strongest line in the middle. Port of the approved preview (artifact A5xNkRRGMoMZuH8s7mvfRL,
 * pass 5; designs/2026-11-06-variants-tree.md). Pure: no React, no DOM.
 */
import type { Sample } from "./marks.js";

/** amazing/good/bad: his call. grew: no call, but a later batch grew from it. open: blind. */
export type Call = "amazing" | "good" | "bad" | "grew" | "unmarked" | "open";

export interface TreeSample extends Sample {
  change: string | null;
  /** the agent's short name; null falls back to the idea's first clause */
  name?: string | null | undefined;
  /** main parent first; two or more = a cross. took = what the child kept from that parent */
  parents?: readonly { id: number; took: string | null }[] | undefined;
}
export interface TreeBatch {
  id: number;
  /** number within the subject (Vireo 0.4.0); older reads fall back to the order */
  n?: number | undefined;
  why: string | null;
  note: string | null;
  state: string;
  createdAt: string;
  closedAt?: string | null | undefined;
  samples: TreeSample[];
}
export interface TreeGuide {
  text: string;
  state: string;
  decidedAt?: string | null | undefined;
}

export interface TNode {
  id: number;
  /** row: batch order, 1-based; 0 is the brief */
  r: number;
  batchId: number;
  v: Call;
  /** p[0] the tree parent; more = a cross */
  p: number[];
  /** per parent id: what this child took from it, in the agent's words */
  took: Record<number, string>;
  name: string;
  /** what changed from the parent: the idea after its first clause */
  delta: string | null;
  change: string | null;
  notes: string[];
  poster: string | null;
  media: string | null;
  body: string | null;
  kept: boolean;
  letter: string | null;
}
export interface TRound {
  /** row in the drawing, from 1 */
  n: number;
  /** the batch's number in its subject, as shown */
  num: number;
  id: number;
  when: string;
  call: string;
  open: boolean;
  note: string | null;
  /** the agent's why on the next batch: what it took from this one */
  took: string | null;
  locks: string[];
}

/** SHUT: a row with no sample drawn after another such row: its name and call only */
export const G = { W: 830, AX: 168, TOP: 34, GEN: 112, SHUT: 72 } as const;
/** snapshot sizes by call: the good line reads first */
export const TH: Record<Call, readonly [number, number]> = {
  amazing: [56, 35],
  good: [46, 29],
  grew: [46, 29],
  unmarked: [36, 23],
  bad: [28, 18],
  open: [46, 29],
};
export const VERD: Record<Call, string> = {
  amazing: "Amazing",
  good: "Good",
  bad: "Bad",
  grew: "Grew a batch",
  unmarked: "No call",
  open: "To mark",
};

const STOP = new Set(
  "a an the at of on in to for from with and or under over into by as its their".split(" "),
);
/** a name in whole words, at most 3 lines: 11 chars a line, wider when it needs more */
export function nameLines(name: string): string[] {
  const max = Math.max(11, Math.ceil(name.length / 3));
  const out: string[] = [];
  for (const w of name.split(/\s+/)) {
    const last = out[out.length - 1];
    if (last !== undefined && `${last} ${w}`.length <= max) out[out.length - 1] = `${last} ${w}`;
    else out.push(w);
  }
  return out;
}
const nameW = (s: TNode) => Math.max(...nameLines(s.name).map((l) => l.length));

/** Short name from the idea's first clause: up to 5 words, cut at a joining word after three,
 * never ending on one. */
export function shortName(text: string | null, fallback: string): string {
  const t = (text ?? "").trim();
  if (!t) return fallback;
  const head = (t.split(/[:;.!?—–]/)[0] ?? t).replace(/\s*\([^)]*\)/g, "").trim() || t;
  const out: string[] = [];
  for (const w of head.split(/\s+/)) {
    if (out.length >= 5 || (out.length >= 3 && STOP.has(w.toLowerCase()))) break;
    out.push(w);
  }
  while (out.length > 1 && STOP.has((out[out.length - 1] ?? "").toLowerCase())) out.pop();
  const s = out.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The idea after its first clause, up to 6 words, no leading article: the edge label. */
export function deltaOf(text: string | null): string | null {
  const m = (text ?? "").match(/^[^:;—–]+[:;—–]\s*(.+)$/);
  // first sentence only
  const rest = ((m?.[1] ?? "").split(/[.!?;](\s|$)/)[0] ?? "").replace(/\s*\([^)]*\)/g, "").trim();
  if (!rest) return null;
  const words = rest.split(/\s+/);
  if (/^(a|an|the)$/i.test(words[0] ?? "") && words.length > 1) words.shift();
  const out = words.slice(0, 6);
  while (out.length > 1 && STOP.has((out[out.length - 1] ?? "").toLowerCase().replace(/,$/, "")))
    out.pop();
  return out.join(" ").replace(/[,.;!?]+$/, "");
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });

export const isGood = (s: TNode) => s.v === "amazing" || s.v === "good";
/** on the line: a good call, or a later batch grew from it */
export const strong = (s: TNode) => isGood(s) || s.v === "grew";

/** `hide`: samples left out of the drawing; calls and batch counts still count them. */
export function treeOf(
  batches: readonly TreeBatch[],
  guides: readonly TreeGuide[],
  hide?: ReadonlySet<number>,
) {
  const bs = [...batches].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const openIds = new Set(bs.filter((b) => b.state === "open").map((b) => b.id));
  // blind: an open batch shows no parents (the API strips them too)
  const parentsOf = new Map<number, readonly { id: number; took: string | null }[]>();
  for (const b of bs)
    if (!openIds.has(b.id)) for (const s of b.samples) parentsOf.set(s.id, s.parents ?? []);
  const grown = new Set([...parentsOf.values()].flatMap((ps) => ps.map((p) => p.id)));
  const S: TNode[] = bs.flatMap((b, bi) => {
    const open = openIds.has(b.id);
    return [...b.samples]
      .sort((x, y) => x.id - y.id)
      .map((s, i) => {
        const letter = open ? String.fromCharCode(65 + i) : null;
        const v: Call = open ? "open" : (s.verdict ?? (grown.has(s.id) ? "grew" : "unmarked"));
        const ps = open ? [] : (parentsOf.get(s.id) ?? []);
        return {
          id: s.id,
          r: bi + 1,
          batchId: b.id,
          v,
          p: ps.map((x) => x.id),
          took: Object.fromEntries(ps.flatMap((x) => (x.took ? [[x.id, x.took]] : []))),
          name: open
            ? `Sample ${letter}`
            : s.name?.trim() || shortName(s.change ?? s.body, `Sample ${s.id}`),
          delta: open ? null : deltaOf(s.change),
          change: open ? null : s.change,
          notes: open ? [] : s.notes.flatMap((n) => (n.text ? [n.text] : [])),
          poster: s.posterUrl ?? null,
          media: s.mediaUrl ?? null,
          body: s.body ?? null,
          kept: !!s.keptAt,
          letter,
        };
      });
  });
  const byId = new Map(S.map((s) => [s.id, s]));
  // parent outside the subject, or not in an earlier row (bad data, a cycle): treat as a seed
  for (const s of S) s.p = s.p.filter((id) => (byId.get(id)?.r ?? s.r) < s.r);
  const rounds: TRound[] = bs.map((b, i) => {
    const mine = S.filter((s) => s.batchId === b.id);
    const marked = mine.filter((s) => s.v === "amazing" || s.v === "good" || s.v === "bad");
    const good = mine.filter(isGood).length;
    const open = openIds.has(b.id);
    const next = bs[i + 1];
    const from = b.closedAt ? +new Date(b.closedAt) : Number.POSITIVE_INFINITY;
    const to = next?.closedAt ? +new Date(next.closedAt) : Number.POSITIVE_INFINITY;
    return {
      n: i + 1,
      num: b.n ?? i + 1,
      id: b.id,
      when: day(b.createdAt),
      open,
      call: open
        ? `${mine.length} to mark`
        : marked.length === mine.length && mine.length && !good
          ? "None of these"
          : marked.length
            ? `${good} of ${mine.length} good`
            : "Note only",
      note: b.note,
      took: next && !openIds.has(next.id) ? next.why : null,
      locks: guides
        .filter((g) => {
          if (g.state !== "locked" || !g.decidedAt) return false;
          const at = +new Date(g.decidedAt);
          return at >= from && at < to;
        })
        .map((g) => g.text),
    };
  });
  if (!hide?.size) return layout(S, rounds);
  const shown = S.filter((s) => !hide.has(s.id));
  // a hidden parent draws no edge: its child hangs from the parents that show
  for (const s of shown) s.p = s.p.filter((id) => !hide.has(id));
  return layout(shown, rounds);
}

/** What to leave out: all but one sample's line, and what grew only from a folded sample. */
export function hiddenBy(t: Tree, branch: number | null, fold: ReadonlySet<number>) {
  const hide = new Set<number>();
  if (branch != null && t.byId.has(branch)) {
    const keep = t.line(branch);
    for (const s of t.S) if (s.v !== "open" && !keep.has(s.id)) hide.add(s.id);
  }
  const under = new Set<number>();
  for (const s of [...t.S].sort((a, b) => a.r - b.r))
    if (s.p.length && s.p.every((p) => fold.has(p) || under.has(p))) under.add(s.id);
  for (const id of under) hide.add(id);
  // what each shown fold hides, for its "+N"
  const count = new Map<number, number>();
  for (const f of fold) {
    if (!t.byId.has(f) || hide.has(f)) continue;
    const n = [...t.line(f)].filter((id) => under.has(id) && id !== f).length;
    if (n) count.set(f, n);
  }
  return { hide, count };
}

function layout(S: TNode[], rounds: TRound[]) {
  const byId = new Map(S.map((s) => [s.id, s]));
  const prim = (s: TNode) => s.p[0] ?? 0;
  const kids = (id: number) => S.filter((s) => s.p.includes(id));
  const tkids = (id: number) => S.filter((s) => s.v !== "open" && prim(s) === id);
  const under = new Map<number, number>();
  const strongUnder = (id: number): number => {
    const got = under.get(id);
    if (got != null) return got;
    const s = byId.get(id);
    const n = (s && strong(s) ? 1 : 0) + kids(id).reduce((a, k) => a + strongUnder(k.id), 0);
    under.set(id, n);
    return n;
  };
  /** room a leaf takes, in columns: wide enough for its snapshot */
  // a long name widens its leaf
  const room = (s: TNode) =>
    Math.max(
      strong(s) ? 2.4 : s.v === "unmarked" ? 1.45 : 1.15,
      strong(s) ? nameW(s) * 0.17 + 0.6 : 0,
    );
  const loose = (s: TNode) => prim(s) === 0 && !strong(s) && !tkids(s.id).length;
  // lines from the brief keep a clear column; loose seeds pack to the sides
  const X = new Map<number, number>();
  let cur = 0;
  const seeds = tkids(0)
    .filter((s) => !loose(s))
    .sort((a, b) => strongUnder(b.id) - strongUnder(a.id) || a.r - b.r || a.id - b.id);
  const order: TNode[] = [];
  // strongest in the middle
  for (const [i, s] of seeds.entries()) {
    if (i % 2) order.push(s);
    else order.unshift(s);
  }
  const place = (s: TNode) => {
    const ch = tkids(s.id);
    const start = cur;
    if (!ch.length) {
      const w = room(s);
      X.set(s.id, cur + w / 2);
      cur += w;
      return;
    }
    ch.forEach(place);
    const first = ch[0];
    const last = ch[ch.length - 1];
    if (first && last) X.set(s.id, ((X.get(first.id) ?? 0) + (X.get(last.id) ?? 0)) / 2);
    const need = strongUnder(s.id) ? 2.4 : 1.15;
    if (cur - start < need) {
      // centre a thin subtree in its room
      const d = (need - (cur - start)) / 2;
      for (const [k, v] of X) if (k === s.id || (v >= start && v <= cur)) X.set(k, v + d);
      cur = start + need;
    }
    // a named parent's label sits to its right: keep the next sibling clear of it
    if (strong(s)) cur += 1.4;
  };
  order.forEach(place);
  const L: Record<number, number> = {};
  const R: Record<number, number> = {};
  const GAP = 1.3; // room for a right-hand name
  let lo = 0;
  let hi = cur;
  S.filter((s) => s.v !== "open" && loose(s)).forEach((s, i) => {
    const w = room(s);
    if (i % 2 === 0) {
      L[s.r] = (L[s.r] ?? 0) + w;
      X.set(s.id, -(L[s.r] ?? 0) + w / 2);
      lo = Math.min(lo, -(L[s.r] ?? 0));
    } else {
      R[s.r] = (R[s.r] ?? GAP) + w;
      X.set(s.id, cur + (R[s.r] ?? 0) - w / 2);
      hi = Math.max(hi, cur + (R[s.r] ?? 0));
    }
  });
  const total = hi - lo || 1;
  const openRow = new Map<number, TNode[]>();
  for (const s of S) if (s.v === "open") openRow.set(s.r, [...(openRow.get(s.r) ?? []), s]);
  const drawn = new Set(S.map((s) => s.r));
  const ys: number[] = [G.TOP];
  // the first empty row keeps full room: names and "+N" chips hang below the row above
  for (let i = 0; i < rounds.length; i++)
    ys.push((ys[i] ?? G.TOP) + (drawn.has(i + 1) || drawn.has(i) || i === 0 ? G.GEN : G.SHUT));
  /** the y of row r (1-based) */
  const rowY = (r: number) => ys[r] ?? G.TOP + r * G.GEN;
  const pos = (s: TNode | null) => {
    if (!s) return { x: G.AX + (G.W - G.AX) / 2, y: G.TOP };
    const y = rowY(s.r);
    if (s.v === "open") {
      const row = openRow.get(s.r) ?? [];
      // 58 apart; tighter when a big batch would leave the frame
      const step = Math.min(58, (G.W - G.AX - 48) / Math.max(1, row.length - 1));
      return { x: G.AX + (G.W - G.AX) / 2 + (row.indexOf(s) - (row.length - 1) / 2) * step, y };
    }
    const f = ((X.get(s.id) ?? 0) - lo) / total;
    return { x: G.AX + 14 + f * (G.W - G.AX - 28), y };
  };
  const line = (id: number) => {
    const out = new Set([id]);
    const up = (i: number) =>
      byId.get(i)?.p.forEach((p) => {
        if (!out.has(p)) {
          out.add(p);
          up(p);
        }
      });
    const down = (i: number) =>
      kids(i).forEach((k) => {
        if (!out.has(k.id)) {
          out.add(k.id);
          down(k.id);
        }
      });
    up(id);
    down(id);
    return out;
  };
  const goodLine = () => {
    const out = new Set<number>();
    const up = (i: number) => {
      out.add(i);
      for (const p of byId.get(i)?.p ?? []) up(p);
    };
    for (const s of S.filter(strong)) up(s.id);
    return out;
  };
  /** tree-parent chain, oldest first */
  const pathUp = (id: number) => {
    const out: TNode[] = [];
    let s = byId.get(id);
    while (s) {
      out.unshift(s);
      s = s.p[0] != null ? byId.get(s.p[0]) : undefined;
    }
    return out;
  };
  const pick =
    [...S].filter(strong).sort((a, b) => b.r - a.r || strongUnder(b.id) - strongUnder(a.id))[0] ??
    [...S].reverse().find((s) => s.v !== "open") ??
    S[0] ??
    null;
  return {
    S,
    rounds,
    byId,
    kids,
    tkids,
    loose,
    strongUnder,
    pos,
    line,
    goodLine,
    pathUp,
    first: pick?.id ?? null,
    rowY,
    height: rowY(rounds.length) + 46,
  };
}
export type Tree = ReturnType<typeof treeOf>;
