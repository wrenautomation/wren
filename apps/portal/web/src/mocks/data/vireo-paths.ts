/**
 * Vireo's tree for Explorer's stories (`paths/*` under `vireo`): a `VireoSource` over the Variants
 * mocks, so Explorer and Variants show one fake world. Blind as a signed-in viewer sees it: an
 * open batch has no why, and its samples no lineage or guides. Synthetic data only.
 */
import { PathError } from "@wren/core/paths";
import type {
  VireoApplied,
  VireoBatch,
  VireoGuide,
  VireoSample,
  VireoSource,
  VireoSubject,
  VireoSubjectSeen,
} from "@wren/paths/vireo-tree";
import { VARIANTS_ANSWERS } from "./variants.js";
import { NOTES_ONLY, TREE_SUBJECT } from "./variants-tree.js";

/** a sample as the Variants mocks hold it */
interface Fed {
  id: number;
  name?: string | null;
  body: string | null;
  mediaUrl: string | null;
  posterUrl: string | null;
  parents?: { id: number }[];
  verdict: string | null;
  score: number | null;
  keptAt: unknown;
  change?: string | null;
  notes?: unknown[];
}
interface FedBatch {
  id: number;
  n: number;
  title?: string | null;
  why?: string | null;
  note: string | null;
  state: string;
  goodRate?: number | null;
  samples: Fed[];
}
interface FedSubject {
  subject: VireoSubjectSeen["subject"];
  guides?: {
    id: number;
    text: string;
    source: string;
    state: string;
    subjectId: number | null;
    kind: string | null;
  }[];
  batches: FedBatch[];
}
interface Queued {
  subject: VireoSubjectSeen["subject"];
  batch: Omit<FedBatch, "state" | "samples">;
  samples: Fed[];
}

const A = VARIANTS_ANSWERS as Record<string, unknown>;
const LISTED = A["variants/subjects"] as VireoSubject[];
const QUEUE = A["variants/queue"] as Queued[];
const subjectAnswer = A["variants/subject"] as (b: { id: number }) => FedSubject;

/** the guides each sample applied (the Variants mocks hold none): two guides with real kin */
const APPLIES: Record<number, number[]> = {
  7: [11],
  13: [11, 12],
  15: [11],
  22: [1],
  24: [1],
  27: [1, 2],
  28: [1],
};

/** One subject whole: its own answer, else its queued open batch alone. */
function fedOf(s: VireoSubject): FedSubject {
  const own = [TREE_SUBJECT, NOTES_ONLY].find((x) => x.subject.id === s.id) as
    | FedSubject
    | undefined;
  const answered = own ?? subjectAnswer({ id: s.id });
  const queued = QUEUE.find((q) => q.subject.id === s.id);
  if (answered.subject.id === s.id)
    return {
      ...answered,
      // an open batch the answer holds empty: its samples from the queue
      batches: answered.batches.map((b) =>
        !b.samples.length && queued?.batch.id === b.id ? { ...b, samples: queued.samples } : b,
      ),
    };
  if (!queued) throw new PathError("unknown-path", `no subject ${s.slug}`);
  return {
    subject: queued.subject,
    guides: [],
    batches: [{ ...queued.batch, state: "open", samples: queued.samples }],
  };
}

const sampleOf = (x: Fed, position: number, blind: boolean): VireoSample => ({
  id: x.id,
  position,
  name: blind ? null : (x.name ?? null),
  body: x.body,
  posterUrl: x.posterUrl,
  mediaUrl: x.mediaUrl,
  parents: blind ? [] : (x.parents ?? []).map((p) => ({ id: p.id })),
  guides: blind ? [] : (APPLIES[x.id] ?? []),
  verdict: x.verdict,
  score: x.score,
  keptAt: x.keptAt,
  detail: blind ? { notes: x.notes ?? [] } : { change: x.change ?? null, notes: x.notes ?? [] },
});

function seenOf(f: FedSubject): VireoSubjectSeen {
  const batches: VireoBatch[] = f.batches.map((b) => {
    const blind = b.state === "open";
    return {
      id: b.id,
      n: b.n,
      ref: `${f.subject.slug}:${b.n}`,
      title: b.title ?? null,
      why: blind ? null : (b.why ?? null),
      state: b.state,
      note: b.note,
      blind,
      detail: blind ? {} : { goodRate: b.goodRate ?? null, judges: b.goodRate == null ? 0 : 1 },
      samples: b.samples.map((x, i) => sampleOf(x, i, blind)),
    };
  });
  const { id, slug, name, kind, brief } = f.subject;
  return {
    subject: { id, slug, name, kind, brief },
    batches,
    guides: (f.guides ?? []).map((g) => ({ id: g.id })),
  };
}

const SEEN = new Map(LISTED.map((s) => [s.slug, seenOf(fedOf(s))]));

const GUIDES: VireoGuide[] = LISTED.map(fedOf)
  .flatMap((f) => f.guides ?? [])
  .filter((g, i, all) => all.findIndex((x) => x.id === g.id) === i)
  .sort((a, b) => a.id - b.id)
  .map((g) => ({
    id: g.id,
    text: g.text,
    source: g.source,
    ref: null,
    kind: g.kind,
    state: g.state,
    subject: LISTED.find((s) => s.id === g.subjectId)?.slug ?? null,
  }));

export const VIREO_SOURCE: VireoSource = {
  subjects: async () => LISTED,
  subject: async (slug) => {
    const s = SEEN.get(slug);
    if (!s) throw new PathError("unknown-path", `no subject ${slug}`);
    return s;
  },
  guides: async () => GUIDES,
  // a blind sample carries no guides, so an open batch never shows here
  appliedIn: async (guide) =>
    [...SEEN.values()].flatMap((x) =>
      x.batches.flatMap((b) =>
        b.samples
          .filter((s) => s.guides.includes(guide))
          .map(
            (s): VireoApplied => ({
              id: s.id,
              name: s.name,
              position: s.position,
              posterUrl: s.posterUrl,
              batch: b.id,
              subject: x.subject.slug,
            }),
          ),
      ),
    ),
};
