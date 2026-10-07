/**
 * A lead's journey as a graph: every touch in time order, a lane per channel, each wire saying
 * how long after the one before it came. Pure: the page reads the touches, the kit draws them.
 */
import type { GraphEdge, GraphNode, GraphTone } from "./model.js";

export interface Touch {
  /** When it happened: an ISO time. */
  at: string;
  /** Its lane: "Email", "Texts", "LinkedIn", "Calls". */
  channel: string;
  /** What happened, one of KINDS or any word. */
  kind: string;
  /** What it said: a subject, a reply's first words. */
  label: string;
  /** One more fact: "step 2", "to the recruiter". */
  note?: string | undefined;
}

/** How each kind of touch reads and shows. Anything else shows its own word. */
export const KINDS: Readonly<Record<string, { label: string; tone: GraphTone }>> = {
  sent: { label: "Sent", tone: "neutral" },
  reply: { label: "Replied", tone: "good" },
  booked: { label: "Booked", tone: "good" },
  called: { label: "Called", tone: "accent" },
  bounce: { label: "Bounced", tone: "bad" },
  complaint: { label: "Complaint", tone: "bad" },
  opt_out: { label: "Opted out", tone: "warn" },
  auto_reply: { label: "Auto reply", tone: "neutral" },
};

/** The most a journey draws; older touches fold into its first node's note. */
export const MOST_TOUCHES = 40;

const H = 3_600_000;
/** "same time", "40 min later", "5 h later", "2 days later". */
export function gapOf(from: string, to: string): string {
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms) || ms < 60_000) return "same time";
  if (ms < H) return `${Math.round(ms / 60_000)} min later`;
  if (ms < 24 * H) return `${Math.round(ms / H)} h later`;
  const d = Math.round(ms / (24 * H));
  return `${d} day${d === 1 ? "" : "s"} later`;
}

const dayOf = (at: string, zone?: string) => {
  const t = new Date(at);
  return Number.isNaN(t.getTime())
    ? ""
    : t.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: zone });
};

export function journeyOf(
  touches: readonly Touch[],
  zone?: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const sorted = [...touches].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const earlier = Math.max(0, sorted.length - MOST_TOUCHES);
  const shown = sorted.slice(earlier);
  const nodes = shown.map((t, i): GraphNode => {
    const kind = KINDS[t.kind] ?? { label: t.kind.replace(/_/g, " "), tone: "neutral" as const };
    const note = [
      t.channel,
      dayOf(t.at, zone),
      t.note,
      i === 0 && earlier ? `${earlier} earlier not shown` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      id: `t${i}`,
      kind: "step",
      // What came back from the lead starts something; a booking is the delivery.
      role: /book/.test(t.kind)
        ? "deliver"
        : /repl|answer|click/.test(t.kind)
          ? "trigger"
          : "channel",
      label: t.label || kind.label,
      note,
      state: kind,
      lane: t.channel,
      facets: { Channel: t.channel, What: kind.label },
    };
  });
  const edges = shown.slice(1).map(
    (t, i): GraphEdge => ({
      from: `t${i}`,
      to: `t${i + 1}`,
      label: gapOf(shown[i]?.at ?? t.at, t.at),
    }),
  );
  return { nodes, edges };
}
