/**
 * Editing a workflow on the canvas (designs/2026-10-05-workflows.md, Editing): a draft of its
 * routed wires and custom steps over what the server drew. Pure, so it tests without a browser.
 */
import type { EventKind, Port } from "@wren/core/components";
import type { Own, Wire } from "@wren/core/workflows";
import type { Drawn } from "../marketplace/boxes.js";

export type Step = { id: string; own: Own };
export interface Draft {
  wires: Wire[];
  steps: Step[];
}
/** A workflow's newest save, as the catalog's detail carries it. */
export interface Saved {
  edits: Draft | null;
  by: string;
  at: string;
}

type End = { ref: string; port: Port; node: string };

/** What can leave a box (`from`) or arrive at one (`to`); `in.x` and `out.x` are the workflow's. */
export function endsOf(w: Drawn, box: string, side: "from" | "to"): End[] {
  const [head = "", id] = box.split(".");
  const own = { in: w.in, out: w.out }[head];
  if (own)
    return head === (side === "from" ? "in" : "out")
      ? own.filter((p) => p.id === id).map((port) => ({ ref: box, port, node: head }))
      : [];
  const n = w.nodes.find((x) => x.id === box);
  return ((side === "from" ? n?.out : n?.in) ?? []).map((port) => ({
    ref: `${box}.${port.id}`,
    port,
    node: n?.name ?? box,
  }));
}

/** Every wire `from` may send to `to`: an output onto an input of the same kind. */
export const pairsOf = (w: Drawn, from: string, to: string): Wire[] =>
  endsOf(w, from, "from").flatMap((a) =>
    endsOf(w, to, "to")
      .filter((b) => b.port.kind === a.port.kind)
      .map((b) => ({ from: a.ref, to: b.ref, via: "events" as const })),
  );

/** Every end on the canvas, for the wire form: what a keyboard picks from. */
export const allEnds = (w: Drawn, side: "from" | "to"): End[] =>
  [
    ...(side === "from" ? w.in.map((p) => `in.${p.id}`) : w.out.map((p) => `out.${p.id}`)),
    ...w.nodes.map((n) => n.id),
  ].flatMap((box) => endsOf(w, box, side));

/** "Follow-up: replies", or "In: leads" for the workflow's own, on the side it's on. */
export function endText(w: Drawn, ref: string, side: "from" | "to"): string {
  const [head = "", port = ""] = ref.split(".");
  const n = w.nodes.find((x) => x.id === head);
  const name = head === "in" ? "In" : head === "out" ? "Out" : (n?.name ?? head);
  const box = head === "in" || head === "out" ? ref : head;
  return `${name}: ${endsOf(w, box, side).find((e) => e.ref === ref)?.port.label ?? port}`;
}

/** The draft as the server drew it: its routed wires, and the custom steps its save added. */
export function draftOf(w: Drawn, saved: Saved | null, broken: boolean): Draft {
  return {
    wires: w.wires
      .filter((x) => x.via === "events")
      .map(({ from, to, via, when, wait }) => ({
        from,
        to,
        via,
        ...(when ? { when } : {}),
        ...(wait ? { wait } : {}),
      })),
    steps: broken ? [] : (saved?.edits?.steps ?? []),
  };
}

/** `w` with the draft in place of `first`: the code's nodes and built-in wires stay. */
export function drawnWith(w: Drawn, first: Draft, d: Draft): Drawn {
  const added = new Set(first.steps.map((s) => s.id));
  const nodes: Drawn["nodes"] = [
    ...w.nodes.filter((n) => !added.has(n.id)),
    ...d.steps.map((s) => ({
      id: s.id,
      uses: null,
      name: s.own.name,
      note: "Custom step",
      ready: null,
      in: s.own.in,
      out: s.own.out,
    })),
  ];
  const next = { ...w, nodes };
  const label = (ref: string) => {
    const [head = ""] = ref.split(".");
    const box = head === "in" ? ref : head;
    return endsOf(next, box, "from").find((e) => e.ref === ref)?.port.label;
  };
  return {
    ...next,
    wires: [
      ...w.wires.filter((x) => x.via === "code"),
      ...d.wires.map((x) => ({
        ...x,
        label: label(x.from) ?? x.from,
        count: w.wires.find((y) => y.from === x.from && y.to === x.to)?.count ?? null,
      })),
    ],
  };
}

/** The draft with `x` wired, once. */
export const wired = (d: Draft, x: Wire): Draft =>
  d.wires.some((y) => y.from === x.from && y.to === x.to) ? d : { ...d, wires: [...d.wires, x] };

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+|_+$/g, "")
    .slice(0, 40);

/** A custom step from the form: one input, outputs of one kind, each event posted to `url`. */
export function stepOf(
  w: Drawn,
  f: { name: string; url: string; takes: EventKind; gives: EventKind; outs: string },
): Step {
  const base = slug(f.name) || "step";
  const taken = new Set(w.nodes.map((n) => n.id));
  let id = base;
  for (let i = 2; taken.has(id); i += 1) id = `${base}_${i}`;
  const outs = f.outs
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    id,
    own: {
      name: f.name.trim(),
      blurb: "",
      icon: "code",
      in: [{ id: f.takes, label: f.takes, kind: f.takes }],
      out: (outs.length ? outs : ["done"]).map((label) => ({
        id: slug(label) || "done",
        label,
        kind: f.gives,
      })),
      run: f.url.trim(),
    },
  };
}

/** The draft without step `id` and every wire that touches it. */
export const withoutStep = (d: Draft, id: string): Draft => ({
  steps: d.steps.filter((s) => s.id !== id),
  wires: d.wires.filter((x) => ![x.from, x.to].some((r) => r.split(".")[0] === id)),
});
