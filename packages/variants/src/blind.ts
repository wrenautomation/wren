/**
 * Vireo's blind rule (vireo D11) on a subject's feedback: while a batch is open, a viewer sees the
 * work, not where it came from. Its samples lose change, parents, guides, agent and strength, and
 * keep only the viewer's own calls and notes; the batch loses why, good rate and judges. The name
 * stays (it says what the sample tries, vireo 0.15.1). No viewer (an agent, the CLI): nothing hidden.
 * VariantsConsole and Explorer's Vireo tree both read through it.
 */
import type { Feedback } from "@wrenautomation/vireo";

type Batch = Feedback["batches"][number];
type Sample = Batch["samples"][number];

function ownOnly(x: Sample, viewer: string) {
  const mine = x.calls.find((c) => c.by === viewer);
  return {
    ...x,
    change: null,
    parents: [],
    guides: [],
    agent: null,
    strength: null,
    calls: mine ? [mine] : [],
    score: mine?.score ?? null,
    verdict: mine?.verdict ?? null,
    notes: x.notes.filter((n) => n.by === viewer),
  };
}

export function blindFeedback(f: Feedback, viewer: string | null) {
  return {
    ...f,
    batches: f.batches.map((b) => {
      if (viewer == null || b.state !== "open") return b;
      return {
        ...b,
        why: null,
        goodRate: null,
        judges: [],
        samples: b.samples.map((x) => ownOnly(x, viewer)),
      };
    }),
  };
}
export type SeenFeedback = ReturnType<typeof blindFeedback>;
