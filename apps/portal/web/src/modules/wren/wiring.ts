/**
 * Editing a workflow on the canvas (designs/2026-10-05-workflows.md, Editing, and
 * 2026-10-06-workflow-editor.md): a draft of its routed wires and added nodes over what the
 * server drew. An added node is a custom step, a logic node or trigger, or a part or workflow
 * from the palette. Pure, so it tests without a browser.
 */
import type { EventKind, Port } from "@wren/core/components";
import { type LogicSetting, logicOf, logicProblems, startWith } from "@wren/core/logic";
import type { Own, Wire } from "@wren/core/workflows";
import type { GraphMark } from "@wren/ui";
import type { Drawn } from "../marketplace/boxes.js";

export type With = Record<string, string | number>;
export type Step = { id: string; own?: Own; uses?: string; with?: With; note?: string };

/** A part or workflow the palette offers, with its ports. */
export interface PaletteItem {
  id: string;
  name: string;
  blurb: string;
  icon: string;
  stage?: string;
  in: Port[];
  out: Port[];
  effects: string[];
  ready: "ready" | "coming" | "planned";
}
/** A logic node or trigger the palette offers. */
export interface PaletteLogic {
  id: string;
  name: string;
  blurb: string;
  icon: string;
  group: "logic" | "trigger";
  ready: boolean;
  settings: readonly LogicSetting[];
  start: With;
}
/** What may be added to a workflow, as its detail carries it (`palette`, the team's). */
export interface Palette {
  logic: PaletteLogic[];
  parts: PaletteItem[];
  workflows: PaletteItem[];
}
export const NO_PALETTE: Palette = { logic: [], parts: [], workflows: [] };
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

/**
 * Every wire `from` may send to `to`: an output onto an input of the same kind. `ports` narrows
 * it to the handles a drag joined, when the nodes name theirs.
 */
export const pairsOf = (
  w: Drawn,
  from: string,
  to: string,
  ports: { from?: string | undefined; to?: string | undefined } = {},
): Wire[] =>
  endsOf(w, from, "from")
    .filter((a) => !ports.from || a.port.id === ports.from || from.startsWith("in."))
    .flatMap((a) =>
      endsOf(w, to, "to")
        .filter((b) => !ports.to || b.port.id === ports.to || to.startsWith("out."))
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

/** An added node as the canvas draws it, from what it is. */
export function drawnStep(s: Step, palette: Palette): Drawn["nodes"][number] {
  if (s.own)
    return {
      id: s.id,
      uses: null,
      name: s.own.name,
      note: s.note ?? "Custom step",
      ready: null,
      in: s.own.in,
      out: s.own.out,
    };
  const l = logicOf(s.uses);
  if (l) {
    const w = s.with ?? {};
    return {
      id: s.id,
      uses: l.id,
      name: l.name,
      note: s.note ?? l.says(w),
      ready: l.ready ? "ready" : "planned",
      ...l.ports(w),
      with: w,
    };
  }
  const part = palette.parts.find((p) => p.id === s.uses);
  const flow = palette.workflows.find((p) => p.id === s.uses);
  const p = part ?? flow;
  return {
    id: s.id,
    uses: s.uses ?? null,
    name: p?.name ?? s.uses ?? s.id,
    note: s.note ?? null,
    ready: p?.ready ?? null,
    in: p?.in ?? [],
    out: p?.out ?? [],
    opens: flow ? flow.id : null,
    ...(s.with ? { with: s.with } : {}),
  };
}

/** `w` with the draft in place of `first`: the code's nodes and built-in wires stay. */
export function drawnWith(w: Drawn, first: Draft, d: Draft, palette = NO_PALETTE): Drawn {
  const added = new Set(first.steps.map((s) => s.id));
  const nodes: Drawn["nodes"] = [
    ...w.nodes.filter((n) => !added.has(n.id)),
    ...d.steps.map((s) => drawnStep(s, palette)),
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

/** An id for a new node from its name, taken by no node on the canvas or in the draft. */
export function freeId(w: Drawn, d: Draft, name: string): string {
  const base = slug(name) || "step";
  const taken = new Set([...w.nodes.map((n) => n.id), ...d.steps.map((s) => s.id), "in", "out"]);
  let id = base;
  for (let i = 2; taken.has(id); i += 1) id = `${base}_${i}`;
  return id;
}

/** The draft with a palette item added as a new node: a logic node starts with its settings. */
export function addNode(
  w: Drawn,
  d: Draft,
  uses: string,
  palette: Palette,
): { draft: Draft; id: string } | null {
  const l = logicOf(uses);
  const p = [...palette.parts, ...palette.workflows].find((x) => x.id === uses);
  if (!l && !p) return null;
  const id = freeId(w, d, l ? l.name : (p?.name ?? uses));
  const step: Step = l ? { id, uses, with: startWith(l) } : { id, uses };
  return { draft: { ...d, steps: [...d.steps, step] }, id };
}

/** The draft with one setting of node `id` set, or cleared when empty. */
export function withSet(d: Draft, id: string, field: string, v: string | number): Draft {
  return {
    ...d,
    steps: d.steps.map((s) => {
      if (s.id !== id) return s;
      const { [field]: _, ...rest } = s.with ?? {};
      return { ...s, with: v === "" ? rest : { ...rest, [field]: v } };
    }),
  };
}

const wireKey = (x: Pick<Wire, "from" | "to">) => `${x.from}>${x.to}`;
/** Its keys in order, all the way down: a save read back from jsonb comes in another order. */
const sorted = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([k, x]) => [k, sorted(x)]),
        )
      : v;
const same = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** How `next` differs from `base`: each added, removed or changed node and wire, by id. */
export function diffOf(base: Draft, next: Draft) {
  const marks = <T>(a: readonly T[], b: readonly T[], key: (x: T) => string) => {
    const was = new Map(a.map((x) => [key(x), x]));
    const now = new Map(b.map((x) => [key(x), x]));
    const out = new Map<string, GraphMark>();
    for (const [k, x] of now)
      if (!was.has(k)) out.set(k, "added");
      else if (!same(was.get(k), x)) out.set(k, "changed");
    for (const k of was.keys()) if (!now.has(k)) out.set(k, "removed");
    return out;
  };
  return {
    nodes: marks(base.steps, next.steps, (s) => s.id),
    wires: marks(base.wires, next.wires, wireKey),
  };
}

/** "Draft: 3 changes": how many nodes and wires differ from what's live. */
export const changesOf = (base: Draft, next: Draft) => {
  const d = diffOf(base, next);
  return d.nodes.size + d.wires.size;
};

/**
 * Both drafts on one canvas, for a diff: what `next` has, plus what it took out of `base`. Each
 * node and wire carries its mark; the canvas rings added green and removed red.
 */
export function drawnDiff(
  w: Drawn,
  first: Draft,
  base: Draft,
  next: Draft,
  palette = NO_PALETTE,
): { drawn: Drawn; nodes: Map<string, GraphMark>; edges: Map<string, GraphMark> } {
  const d = diffOf(base, next);
  const gone = base.steps.filter((s) => d.nodes.get(s.id) === "removed");
  const goneWires = base.wires.filter((x) => d.wires.get(wireKey(x)) === "removed");
  const drawn = drawnWith(
    w,
    first,
    { steps: [...next.steps, ...gone], wires: [...next.wires, ...goneWires] },
    palette,
  );
  const box = (ref: string) => {
    const [head = ""] = ref.split(".");
    return head === "in" || head === "out" ? ref : head;
  };
  const edges = new Map<string, GraphMark>();
  for (const [k, m] of d.wires) {
    const [from = "", to = ""] = k.split(">");
    edges.set(`${box(from)}>${box(to)}`, m);
  }
  return { drawn, nodes: d.nodes, edges };
}

/** What won't run in the draft, as the editor can tell before a save: settings and waits. */
export function problemsOf(d: Draft): string[] {
  return [
    ...d.steps.flatMap((s) =>
      logicProblems(s.id, {
        id: s.id,
        ...(s.uses ? { uses: s.uses } : {}),
        ...(s.with ? { with: s.with } : {}),
      }),
    ),
    ...d.wires
      .filter((x) => x.wait && !/^\d+ (minute|hour|day|week)s?$/.test(x.wait.trim()))
      .map((x) => `${x.from} to ${x.to}: a wait reads like "2 days"`),
  ];
}

/** A custom step from the form: one input, outputs of one kind, each event posted to `url`. */
export function stepOf(
  w: Drawn,
  f: { name: string; url: string; takes: EventKind; gives: EventKind; outs: string },
): Step {
  const id = freeId(w, { wires: [], steps: [] }, f.name);
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
