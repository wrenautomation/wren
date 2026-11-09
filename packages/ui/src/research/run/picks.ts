/** Picks and mark keys: what a click names, and its key in the web. */
import type { Indexed } from "./model.js";
import type { Pick } from "./panel.js";
import { parse } from "./web.js";

export type Ident = { n?: string; s?: number; c?: number; q?: number };
/** What a mark is, for the delegated hover and click. web: its web key, when it opens in place. */
export type Hit = { pick: Pick; id: Ident; web?: string; shelf?: boolean };

export const same = (a: Pick | null, b: Pick | null) =>
  !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
export const pkey = (p: Pick | null) =>
  !p
    ? ""
    : p.t === "n"
      ? p.key
      : p.t === "s"
        ? `s${p.id}`
        : p.t === "c"
          ? `c${p.i}`
          : p.t === "q"
            ? `q${p.i}`
            : "";
export const webPick = (k: string): Pick => {
  const [t, a] = parse(k);
  return t === "c"
    ? { t: "c", i: a }
    : t === "q"
      ? { t: "q", i: a }
      : t === "s"
        ? { t: "s", id: a }
        : { t: "n", key: k };
};
export const webIdent = (k: string): Ident => {
  const [t, a] = parse(k);
  return { n: k, ...(t === "s" ? { s: a } : t === "c" ? { c: a } : t === "q" ? { q: a } : {}) };
};
export const toggled = <T>(s: ReadonlySet<T>, v: T) => {
  const n = new Set(s);
  n.has(v) ? n.delete(v) : n.add(v);
  return n;
};

/** A detail window's tab name: what its pick shows. */
export function titleOf(L: Indexed, p: Pick | null): string {
  if (!p) return "Detail";
  if (p.t === "s") return L.byId.get(p.id)?.s.name ?? "Source";
  if (p.t === "c") {
    const c = L.run.claims[p.i];
    return c ? `${c.n}. ${c.head}` : "Claim";
  }
  if (p.t === "q") return L.byQ.get(p.i)?.t ?? "Search";
  if (p.t === "D") return "Dropped hits";
  const [t, a, b] = parse(p.key);
  if (t === "r") return L.run.runs?.[a - 1]?.t ?? `Run ${a}`;
  const n = L.byId.get(a);
  if (t === "p") return n?.s.pages[b]?.t ?? "Page";
  if (t === "f" || t === "x") return n ? `Finding · ${n.s.name}` : "Finding";
  if (t === "d" || t === "h") {
    const qi = t === "d" ? a : L.run.dropped[a]?.q[0];
    return (qi != null && L.byQ.get(qi)?.t) || "Search";
  }
  return n?.s.name ?? "Detail";
}
