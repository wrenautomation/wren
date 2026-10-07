/**
 * Play: a made-up lead walks a workflow on the canvas, a step at a time, each step showing the
 * copy it would get and each wait cut to a second or two. For demos and recordings. It reads
 * copy and writes nothing: the lead exists only in this file.
 */
import type { Drawn } from "../marketplace/boxes.js";
import { boxOf } from "./canvas.js";

/** The lead who walks. Made up; example.com never receives mail. */
export const LEAD: Readonly<Record<string, string>> = {
  first_name: "Sam",
  last_name: "Rivera",
  name: "Sam Rivera",
  full_name: "Sam Rivera",
  company: "Northwind Staffing",
  company_name: "Northwind Staffing",
  company_short: "Northwind",
  firm: "Northwind Staffing",
  email: "sam@example.com",
  title: "Managing Partner",
  city: "Toronto",
};

export interface PlayStep {
  /** The graph's node id: a node, or the workflow's `in.x` / `out.x`. */
  box: string;
  label: string;
  /** The wire it came in on (`edgeId`), none for the first. */
  edge: string | null;
  /** The wire's wait, as written: "3 days". */
  wait: string | null;
  /** What it uses, to find its copy. */
  uses: string | null;
}

/**
 * The longest path through `w`'s wires, from where things come in to where they leave, so a
 * walk reaches the end (a booked call, a client won) rather than the first branch's.
 */
export function walkOf(w: Drawn): PlayStep[] {
  const arcs = new Map<string, { to: string; wait: string | null }[]>();
  const into = new Set<string>();
  for (const x of w.wires) {
    const [a, b] = [boxOf(x.from), boxOf(x.to)];
    if (a === b) continue;
    arcs.set(a, [...(arcs.get(a) ?? []), { to: b, wait: x.wait ?? null }]);
    into.add(b);
  }
  const boxes = [
    ...w.in.map((p) => `in.${p.id}`),
    ...w.nodes.map((n) => n.id),
    ...w.out.map((p) => `out.${p.id}`),
  ];
  const memo = new Map<string, string[]>();
  const longest = (at: string, seen: ReadonlySet<string>): string[] => {
    const known = memo.get(at);
    if (known && !known.some((b) => seen.has(b))) return known;
    let best: string[] = [];
    for (const a of arcs.get(at) ?? []) {
      if (seen.has(a.to)) continue;
      const rest = longest(a.to, new Set([...seen, a.to]));
      if (rest.length > best.length) best = rest;
    }
    const path = [at, ...best];
    memo.set(at, path);
    return path;
  };
  const starts = boxes.filter((b) => arcs.has(b) && !into.has(b));
  const path = (starts.length ? starts : boxes.slice(0, 1))
    .map((s) => longest(s, new Set([s])))
    .reduce<string[]>((a, b) => (b.length > a.length ? b : a), []);

  const labelOf = (box: string) => {
    const [head, port = ""] = box.split(".");
    if (head === "in") return w.in.find((p) => p.id === port)?.label ?? port;
    if (head === "out") return w.out.find((p) => p.id === port)?.label ?? port;
    return w.nodes.find((n) => n.id === box)?.name ?? box;
  };
  return path.map((box, i) => {
    const prev = path[i - 1];
    return {
      box,
      label: labelOf(box),
      edge: prev ? `${prev}>${box}` : null,
      wait: prev ? (arcs.get(prev)?.find((a) => a.to === box)?.wait ?? null) : null,
      uses: w.nodes.find((n) => n.id === box)?.uses ?? null,
    };
  });
}

const HOUR = 3_600_000;
const UNITS: [RegExp, number][] = [
  [/^(m|mins?|minutes?)$/, HOUR / 60],
  [/^(h|hrs?|hours?)$/, HOUR],
  [/^(d|days?)$/, 24 * HOUR],
  [/^(w|wks?|weeks?)$/, 7 * 24 * HOUR],
];

/** "3 days" in ms; null when it says no amount. */
export function waitOf(wait: string | null | undefined): number | null {
  const m = /(\d+(?:\.\d+)?)\s*([a-z]+)/i.exec(wait ?? "");
  if (!m) return null;
  const unit = UNITS.find(([re]) => re.test(m[2]?.toLowerCase() ?? ""));
  return unit ? Number(m[1]) * unit[1] : null;
}

/** How long Play holds a step: a beat, and a little more the longer the real wait. */
export function beatOf(wait: string | null | undefined): number {
  const real = waitOf(wait);
  return real === null ? 1400 : 1400 + Math.min(2200, Math.log2(1 + real / HOUR) * 260);
}

/** Days since the walk began, after these waits: "Day 0", "Day 3". */
export function dayOf(waits: readonly (string | null)[]): string {
  const ms = waits.reduce((t, w) => t + (waitOf(w) ?? 0), 0);
  return `Day ${Math.floor(ms / (24 * HOUR))}`;
}

/** The lead's facts into copy: `{first_name|there}`, `{company}` and a sample's «first_name». */
export function fill(text: string, lead: Readonly<Record<string, string>> = LEAD): string {
  return text
    .replace(/\{([a-z_.]+)(?:\|([^}]*))?\}/gi, (_, k: string, or?: string) => lead[k] ?? or ?? "")
    .replace(/«([^»]+)»/g, (whole, k: string) => lead[k.trim().replace(/\s+/g, "_")] ?? whole);
}

export type Channel = "email" | "text" | "dm" | "reply" | "booking" | null;

/** Which copy a step shows, read off what it uses. */
export function channelOf(uses: string | null, label: string): Channel {
  const s = `${uses ?? ""} ${label}`.toLowerCase();
  if (/repl/.test(s)) return "reply";
  if (/book|call|meeting/.test(s)) return "booking";
  if (/sms|text/.test(s)) return "text";
  if (/\bdm|outreach|social|linkedin/.test(s)) return "dm";
  if (/email|mail|sequence/.test(s)) return "email";
  return null;
}

/** The lead's side: made up, the same every time. */
export const REPLY = "Sounds interesting. What would it cost us, and how fast could it start?";
export const BOOKING = "Call booked: Tuesday, 10:00, 30 minutes.";
