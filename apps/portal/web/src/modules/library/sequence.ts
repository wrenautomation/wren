/**
 * A sequence as the graph kit draws it, and the words its numbers read as: leads in, then each
 * step with its template, what it sent, its reply rate and its variants, the wait on the wire
 * before it. Pure, so it's tested without a browser.
 */
import type { GraphEdge, GraphNode } from "@wren/ui";
import { percent } from "@wren/ui";

/** One step as the sequence's detail gives it (`templates.sequence` load). */
export interface SeqStep {
  node: string;
  step: number;
  wait: string | null;
  touch: string | null;
  kind: string;
  system: string;
  template: string;
  templateId: string | null;
  liveVersion: string | null;
  sends: number;
  replies: number;
  booked: number | null;
  variants: { picks: unknown; sends: number; replies: number }[];
}

export const CHANNEL: Record<string, string> = {
  email: "Email",
  sms: "Text",
  dm: "DM",
  prompt: "Prompt",
};

/** A send's variant picks in words: `{"s": 1}` reads "s: 2nd"; none is the one version. */
export function picksText(picks: unknown): string {
  const p = typeof picks === "string" ? safe(picks) : picks;
  const entries = p && typeof p === "object" ? Object.entries(p as Record<string, unknown>) : [];
  if (!entries.length) return "One version";
  return entries.map(([k, v]) => `${k}: option ${Number(v) + 1}`).join(", ");
}
const safe = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** "7.5% replied", or nothing before a send. */
export const replyRate = (replies: number, sends: number) =>
  sends > 0 ? `${percent(replies, sends) || "0%"} replied` : "";

/** The most variants a step's card lists; the table has them all. */
const MOST = 3;

export function sequenceGraph(
  steps: readonly SeqStep[],
  hrefOf: (s: SeqStep) => string | undefined,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [
    { id: "in", kind: "account", label: "Leads in", dashed: true },
    ...steps.map(
      (s): GraphNode => ({
        id: s.node,
        kind: "step",
        label: s.template,
        note: `Step ${s.step} · ${CHANNEL[s.kind] ?? s.kind}${s.liveVersion ? "" : " · nothing live"}`,
        dim: !s.liveVersion,
        number: { value: s.sends, label: "sent", href: hrefOf(s) },
        more: s.sends
          ? {
              value: s.replies,
              label: `replied, ${percent(s.replies, s.sends) || "0%"}${
                s.booked ? ` · ${s.booked} booked` : ""
              }`,
            }
          : undefined,
        lines: s.variants.slice(0, MOST).map((v) => ({
          text: `${picksText(v.picks)}: ${replyRate(v.replies, v.sends) || "not sent"}`,
        })),
        href: hrefOf(s),
        facets: { Channel: CHANNEL[s.kind] ?? s.kind },
      }),
    ),
  ];
  const edges = steps.map(
    (s, i): GraphEdge => ({
      from: i === 0 ? "in" : (steps[i - 1]?.node ?? "in"),
      to: s.node,
      // A wait reads "after 2 days"; none goes right away.
      label: s.wait ? undefined : "right away",
      wait: s.wait ?? undefined,
    }),
  );
  return { nodes, edges };
}
