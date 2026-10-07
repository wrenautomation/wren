/**
 * Where Wren runs, as a graph: the hosts in docs/restate-operations.md and what calls what, each
 * with the health the console already measures. Loops say most of it: a loop's service runs on
 * the box or on Lambda, so a failing loop marks its host. A page that loaded at all says the
 * portal, sign-in and the database answer. The rest is measured elsewhere, and says where.
 */
import type { GraphEdge, GraphNode, GraphTone } from "@wren/ui";

/** One `console.loop` row, as its list gives it. */
export interface LoopRow {
  service: string;
  state: string;
  health: string;
  lastAt?: string | null | undefined;
}

/**
 * The services the box worker serves (`BOX_SERVICES`, apps/worker/src/services.ts); every other
 * Wren service runs on Lambda. autobrowse's run on William's Mac.
 */
export const BOX = [
  "PoolScheduler",
  "Discovery",
  "Enrichment",
  "Resolution",
  "PageArchive",
  "Books",
  "Watch",
  "SocialWatch",
];
export const DESK = ["sites", "desk", "do"];

type HostId =
  | "portal"
  | "auth"
  | "phone"
  | "restate"
  | "lambda"
  | "box"
  | "postgres"
  | "browser"
  | "desk"
  | "probe"
  | "probe2"
  | "llm"
  | "lander"
  | "pixel";

interface Host {
  id: HostId;
  label: string;
  /** Where: the machine or the vendor. */
  note: string;
  /** What it runs. */
  lines?: string[];
  /** Where its health is checked when this page can't tell. */
  elsewhere?: string;
}

const HOSTS: Host[] = [
  { id: "lander", label: "Lander", note: "Cloudflare Pages", elsewhere: "Checked in Cloudflare" },
  {
    id: "pixel",
    label: "Open pixel",
    note: "Cloudflare Worker + D1",
    elsewhere: "Tracking is off",
  },
  { id: "portal", label: "Portal", note: "Cloudflare Worker", lines: ["this page"] },
  { id: "auth", label: "Sign-in", note: "Lambda wren-prod-auth" },
  {
    id: "phone",
    label: "Phone",
    note: "Cloudflare Worker",
    elsewhere: "Checked by its texts and hooks",
  },
  {
    id: "restate",
    label: "Restate",
    note: "Docker on wren-prod-pg",
    lines: ["journals, timers, state", "ingress, admin"],
  },
  { id: "lambda", label: "Worker", note: "Lambda wren-prod-worker" },
  { id: "box", label: "Box worker", note: "wren-prod-pg, 127.0.0.1:9080" },
  {
    id: "desk",
    label: "Desk",
    note: "Office Mac",
    lines: ["browser, logins, home IP"],
  },
  {
    id: "postgres",
    label: "Postgres",
    note: "wren-prod-pg",
    lines: ["Postgres 17", "PgBouncer 6432"],
  },
  {
    id: "browser",
    label: "Browser",
    note: "browserless on wren-prod-pg",
    elsewhere: "Checked by the loops that read pages",
  },
  {
    id: "probe",
    label: "Prober",
    note: "RackNerd, Buffalo",
    elsewhere: "Checked in the daily digest",
  },
  {
    id: "probe2",
    label: "Prober 2",
    note: "RackNerd, Los Angeles",
    elsewhere: "Checked in the daily digest",
  },
  {
    id: "llm",
    label: "LLM gateway",
    note: "Cloudflare Worker + DO",
    elsewhere: "Checked by its key rotation",
  },
];

const WIRES: [HostId, HostId, string?][] = [
  ["lander", "phone", "bookings, forms"],
  ["portal", "auth", "sign-in"],
  ["portal", "restate", "records, actions"],
  ["phone", "restate", "hooks, texts"],
  ["restate", "lambda", "most services"],
  ["restate", "box", "the pool chain"],
  ["restate", "desk", "sites, desk, do"],
  ["lambda", "postgres"],
  ["box", "postgres"],
  ["lambda", "browser", "pages"],
  ["lambda", "probe", "address checks"],
  ["lambda", "probe2", "address checks"],
  ["lambda", "llm", "free models"],
];

export interface Health {
  label: string;
  tone: GraphTone;
}

const ago = (at: string | null | undefined, now: number) => {
  const t = at ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 60) return `last pass ${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `last pass ${h} h ago` : `last pass ${Math.round(h / 24)} days ago`;
};

/** A host's loops: running and failing, and when the newest pass ran. */
function loopsOn(loops: readonly LoopRow[], on: (service: string) => boolean, now: number) {
  const mine = loops.filter((l) => on(l.service));
  const running = mine.filter((l) => l.state === "running");
  const failing = running.filter((l) => l.health === "failing");
  const newest = mine
    .map((l) => l.lastAt ?? "")
    .filter(Boolean)
    .sort()
    .at(-1);
  return {
    all: mine.length,
    running: running.length,
    failing: failing.length,
    last: ago(newest, now),
  };
}

/**
 * The map. `loops` is null while they load, an Error when the console couldn't read them (so
 * Restate's admin didn't answer).
 */
export function infraOf(
  loops: readonly LoopRow[] | Error | null,
  now: number = Date.now(),
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const rows = Array.isArray(loops) ? loops : [];
  const read = Array.isArray(loops);
  const box = loopsOn(rows, (s) => BOX.includes(s), now);
  const desk = loopsOn(rows, (s) => DESK.includes(s), now);
  const lambda = loopsOn(rows, (s) => !BOX.includes(s) && !DESK.includes(s), now);

  const ofLoops = (l: ReturnType<typeof loopsOn>): Health =>
    !read
      ? { label: loops ? "Unknown" : "Reading", tone: "neutral" }
      : l.failing
        ? { label: `${l.failing} failing`, tone: "bad" }
        : l.running
          ? { label: "Healthy", tone: "good" }
          : { label: "Idle", tone: "neutral" };
  const health: Partial<Record<HostId, Health>> = {
    portal: { label: "Serving you", tone: "good" },
    auth: { label: "Signed you in", tone: "good" },
    restate: !loops
      ? { label: "Reading", tone: "neutral" }
      : read
        ? { label: "Answering", tone: "good" }
        : { label: "Not answering", tone: "bad" },
    postgres: read
      ? { label: "Answering", tone: "good" }
      : { label: loops ? "Unknown" : "Reading", tone: "neutral" },
    lambda: ofLoops(lambda),
    box: ofLoops(box),
    ...(desk.all ? { desk: ofLoops(desk) } : {}),
  };
  const counted: Partial<Record<HostId, ReturnType<typeof loopsOn>>> = { lambda, box, desk };

  const nodes = HOSTS.map((h): GraphNode => {
    const c = counted[h.id];
    const state = health[h.id] ?? { label: "Measured elsewhere", tone: "neutral" as const };
    const looped = c && c.all > 0;
    return {
      id: h.id,
      kind: "host",
      label: h.label,
      note: h.note,
      state,
      ...(looped
        ? {
            number: { value: c.running, label: "loops running", href: "/loops/all?view=all" },
            ...(c.failing
              ? { more: { value: c.failing, label: "failing", href: "/loops/all?view=failing" } }
              : {}),
          }
        : {}),
      lines: [
        ...(h.lines ?? []).map((text) => ({ text })),
        ...(looped && c.last ? [{ text: c.last }] : []),
        ...(!health[h.id] && h.elsewhere ? [{ text: h.elsewhere }] : []),
      ],
      facets: { Health: state.label },
    };
  });
  const edges = WIRES.map(([from, to, label]): GraphEdge => ({ from, to, label }));
  return { nodes, edges };
}
