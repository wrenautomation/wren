/** The Map's and the canvas's boxes: pure, so they test without a browser. */
import type { Port } from "@wren/core/components";
import type { Row } from "@wren/core/records/serve";
import type { Wire } from "@wren/core/workflows";
import type { MapBox } from "@wren/ui";

const ACCOUNTS: Record<string, string> = {
  gmail: "Gmail",
  linkedin: "LinkedIn",
  calcom: "cal.com",
  telnyx: "Telnyx",
  meta: "Meta",
};

/**
 * The connected parts and their accounts as boxes, in groups that share no line, biggest
 * first, and the parts nothing touches.
 */
export function mapOf(rows: readonly Row[], at: (id: string) => string) {
  const ids = new Set(rows.map((r) => String(r.id)));
  const after = new Map(
    rows.map((r) => [
      String(r.id),
      String(r.needs ?? "")
        .split(", ")
        .filter(Boolean)
        .map((n) => (ids.has(n) ? n : `@${n}`)),
    ]),
  );
  const used = new Set([...after.values()].flat());
  const linked = (id: string) => used.has(id) || !!after.get(id)?.length;
  const accounts = [...used]
    .filter((n) => n.startsWith("@"))
    .map((n): MapBox => {
      const site = n.slice(1);
      return { id: n, label: `${ACCOUNTS[site] ?? site} account`, after: [], input: true };
    });
  const parts = rows.map((r): MapBox => {
    const id = String(r.id);
    return {
      id,
      label: String(r.name),
      note:
        r.installed === "yes"
          ? "Installed"
          : r.ready === "coming"
            ? "Coming"
            : r.ready === "planned"
              ? "In development"
              : r.for === "wren"
                ? "Wren's own"
                : undefined,
      after: after.get(id) ?? [],
      href: at(id),
      dim: r.installed === "no",
    };
  });
  // Accounts last: a column lists its parts first, so fewer lines cross.
  const boxes = [...parts.filter((b) => linked(b.id)), ...accounts];
  const near = new Map(boxes.map((b) => [b.id, new Set(b.after)]));
  for (const b of boxes) for (const a of b.after) near.get(a)?.add(b.id);
  const seen = new Set<string>();
  const groups: MapBox[][] = [];
  for (const b of boxes) {
    if (seen.has(b.id)) continue;
    const group = new Set([b.id]);
    for (const id of group) for (const n of near.get(id) ?? []) group.add(n);
    for (const id of group) seen.add(id);
    groups.push(boxes.filter((x) => group.has(x.id)));
  }
  return {
    groups: groups.sort((a, b) => b.length - a.length),
    alone: parts.filter((b) => !linked(b.id)),
  };
}

/** Where a number comes from: a record type's saved view. */
export type CountRef = { record: string; view: string };

/**
 * A workflow as the server draws it: each node named, with how built what it uses is, and each
 * wire with what moves on it. The team's also says where each number comes from.
 */
export interface Drawn {
  id: string;
  name: string;
  in: Port[];
  out: Port[];
  nodes: {
    id: string;
    uses: string | null;
    name: string;
    note: string | null;
    ready: "ready" | "coming" | "planned" | null;
    /** The workflow it opens into: one it uses, or a part's own steps. */
    opens?: string | null;
    count?: (CountRef & { label: string }) | null;
  }[];
  wires: (Wire & { label?: string; count?: CountRef | null })[];
}

const READY = { coming: "coming", planned: "in development" } as const;
export const countKey = (c: CountRef) => `${c.record}:${c.view}`;
const num = (n: number) => n.toLocaleString("en-US");
const cap = (s: string) => s[0]?.toUpperCase() + s.slice(1);

/** Every number a drawing needs, once each. */
export const countsIn = (w: Drawn): CountRef[] => [
  ...new Map(
    [...w.nodes.map((n) => n.count), ...w.wires.map((x) => x.count)]
      .filter((c): c is CountRef => !!c)
      .map((c) => [countKey(c), { record: c.record, view: c.view }]),
  ).values(),
];

/**
 * A workflow's boxes: its inputs and outputs dashed at the ends, each node linking where `at`
 * says, one not built yet faded, a workflow inside stacked. A line says what moves on it, its
 * number when `counts` has it, and its condition and wait. A line back into its own node is a
 * note on that node.
 */
export function flowBoxes(
  w: Drawn,
  at: (n: Drawn["nodes"][number]) => string | undefined,
  counts: ReadonlyMap<string, number> = new Map(),
): MapBox[] {
  const nodeOf = (end: string) => end.split(".")[0] ?? "";
  const idOf = (end: string) => (["in", "out"].includes(nodeOf(end)) ? end : nodeOf(end));
  const after = new Map<string, Set<string>>();
  const labels = new Map<string, Record<string, string>>();
  const loops = new Map<string, string[]>();
  for (const x of w.wires) {
    const from = idOf(x.from);
    const to = idOf(x.to);
    const n = x.count ? counts.get(countKey(x.count)) : undefined;
    const what = n === undefined ? (x.label ?? "") : `${num(n)} ${x.label ?? ""}`;
    if (from === to) {
      loops.set(to, [
        ...(loops.get(to) ?? []),
        `Again${x.wait ? ` after ${x.wait}` : ""}: ${what}`,
      ]);
      continue;
    }
    if (!after.has(to)) after.set(to, new Set());
    after.get(to)?.add(from);
    const text = [what, x.when ? `if ${x.when}` : "", x.wait ? `after ${x.wait}` : ""]
      .filter(Boolean)
      .join("\n");
    const mine = labels.get(to) ?? {};
    mine[from] = mine[from] ? `${mine[from]}\n${text}` : text;
    labels.set(to, mine);
  }
  const box = (id: string): Pick<MapBox, "after" | "labels"> => ({
    after: [...(after.get(id) ?? [])],
    labels: labels.get(id),
  });
  return [
    ...w.in.map((p): MapBox => ({ id: `in.${p.id}`, label: p.label, input: true, ...box("") })),
    ...w.nodes.map((n): MapBox => {
      const v = n.count ? counts.get(countKey(n.count)) : undefined;
      // A workflow fades only through its parts: a few unbuilt ones don't fade the rest.
      const flow = !!n.uses && n.opens === n.uses;
      return {
        id: n.id,
        label: n.name,
        note:
          [
            n.ready && n.ready !== "ready"
              ? flow
                ? `Parts ${READY[n.ready]}`
                : cap(READY[n.ready])
              : null,
            n.note,
            ...(loops.get(n.id) ?? []),
          ]
            .filter(Boolean)
            .join(". ") || undefined,
        count: n.count && v !== undefined ? `${num(v)} ${n.count.label}` : undefined,
        ...box(n.id),
        href: at(n),
        input: !n.uses,
        dim: !flow && n.ready !== null && n.ready !== "ready",
        stacked: !!n.opens,
      };
    }),
    ...w.out
      .filter((p) => after.has(`out.${p.id}`))
      .map(
        (p): MapBox => ({ id: `out.${p.id}`, label: p.label, input: true, ...box(`out.${p.id}`) }),
      ),
  ];
}
