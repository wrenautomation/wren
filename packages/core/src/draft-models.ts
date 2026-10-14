/**
 * Which model writes reach drafts (thread replies, comments on others' posts, comment answers,
 * DMs, invite notes), and how two of them are compared (designs/2026-10-14-draft-models.md).
 *
 * The Monitor's model (mail triage) is its own setting. Drafts read `drafts.model`: a list of
 * arms, each a model spec and a weight. An item's arm is a stable hash of its Inbox id, so a
 * redraft stays on the same arm and the split holds with no state. One arm means no test.
 * `scoreArms` turns kept draft steps into one row per arm; `verdict` says when one is clearly
 * ahead. Nothing here switches a model: the report says, William sets.
 */
import type { Queryable } from "@wren/db";
import { z } from "zod";
import { settingsFor } from "./clients/index.js";
import { modelLabel } from "./model-labels.js";

export const DRAFT_MODELS_COMPONENT = "drafts.model";

export const draftArmSchema = z
  .object({
    /** A `makeLlm` spec: "gateway:free", "cohere", "gemini:gemini-3.8-flash". */
    model: z.string().trim().min(1).max(100),
    /** Share of items, relative to the other arms' weights. */
    weight: z.number().positive().max(1000),
  })
  .strict();
export type DraftArm = z.infer<typeof draftArmSchema>;

export const draftModelsSchema = z
  .object({ arms: z.array(draftArmSchema).min(1).max(4) })
  .strict()
  .refine((s) => new Set(s.arms.map((a) => a.model)).size === s.arms.length, {
    message: "each arm names a different model",
  });
export type DraftModels = z.infer<typeof draftModelsSchema>;

/** The test William asked for 2026-10-14: the gateway's free chain (Gemini first) against Cohere. */
export const DEFAULT_ARMS: readonly DraftArm[] = [
  { model: "gateway:free", weight: 50 },
  { model: "cohere", weight: 50 },
];

/** The saved arms; none saved, or a block that doesn't read, is the default test. */
export async function draftArms(db: Queryable): Promise<readonly DraftArm[]> {
  const got = draftModelsSchema.safeParse(
    (await settingsFor(db, null))[DRAFT_MODELS_COMPONENT] ?? {},
  );
  return got.success ? got.data.arms : DEFAULT_ARMS;
}

/** FNV-1a, 32 bit, then mixed: small, stable across runs and machines, an even split. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Murmur3's finalizer: FNV alone leaves ids that differ in their last characters lopsided.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** An item's arm: its id hashed onto the weights. The same id and arms always give the same arm. */
export function armOf(item: string, arms: readonly DraftArm[]): DraftArm {
  const first = arms[0];
  if (!first) throw new Error("no arms");
  const total = arms.reduce((n, a) => n + a.weight, 0);
  let at = (hash32(item) / 2 ** 32) * total;
  for (const a of arms) {
    if (at < a.weight) return a;
    at -= a.weight;
  }
  return first;
}

/**
 * Arms as people read them. A gateway alias is a chain, named by its first model; the row says
 * "falls through when spent" in its tooltip, not here.
 */
const ARM_LABELS: Readonly<Record<string, string>> = {
  "gateway:free": "Gemini 3.8 Flash",
  gateway: "Gemini 3.8 Flash",
  cohere: "Command A",
  "cohere:command-a-03-2025": "Command A",
};
export const armLabel = (id: string): string => ARM_LABELS[id] ?? modelLabel(id);

/** Draft kinds a reach model writes, as the training record keeps them. */
export const REACH_DRAFT_KINDS = [
  "thread",
  "post_comment",
  "comment",
  "dm",
  "invite_note",
] as const;
/** The guard stages that draft those kinds (`recordGuard`'s stage; `%.comment_draft` is per platform). */
export const REACH_GUARD_STAGES = [
  "reddit.draft",
  "comments.sort",
  "reach.dm_draft",
  "reach.invite_note",
] as const;

// --- the scorecard -------------------------------------------------------------------------

/** One draft a model wrote, as it ended, for the scorecard. */
export interface ScoredDraft {
  item: string;
  /** The model that wrote the version he saw (`draft_events.by`). */
  by: string;
  /** True when an arm of the test chose the model (`meta.arm`); false for history and other paths. */
  armed: boolean;
  /** What the model wrote. */
  written: string;
  /** What happened after: sent or approved (with the words that went out), turned down, or open. */
  end: { is: "approved"; text: string } | { is: "rejected" } | { is: "open" };
  /** The comment proof's state when it was sent and checked (`comment_proofs`). */
  proof?: string | null;
  /** Replies back to it (`draft_outcomes`), when that view reads this item. */
  replies?: number | null;
}

export interface ArmRow {
  by: string;
  /** In the test (an arm chose it), or outside it (history, the Inbox's own suggestions). */
  armed: boolean;
  label: string;
  /** Drafts that reached him. */
  generated: number;
  approvedUnedited: number;
  approvedEdited: number;
  rejected: number;
  open: number;
  /** Dropped by the facts guard after both tries: no draft reached him. */
  dropped: number;
  /** Flagged by the guard once, then clean on the second try. */
  redrafted: number;
  /** Mean characters changed, over the edited approvals; null when none. */
  editChars: number | null;
  /** Mean share of the draft rewritten (0..1), over the edited approvals; null when none. */
  editShare: number | null;
  /** Of the sent ones checked: live, hidden, missing. */
  proof: { live: number; hidden: number; missing: number };
  /** Sent drafts whose item has an answer back, of those the view reads. */
  replied: number;
  repliable: number;
  /** Approved unedited, of those decided (approved or rejected): 0..1; null when none decided. */
  uneditedRate: number | null;
  decided: number;
}

/** Characters changed between two texts: Levenshtein, two rows. Long texts are cut at 3000. */
export function editChars(from: string, to: string): number {
  const a = from.trim().slice(0, 3000);
  const b = to.trim().slice(0, 3000);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : null);

/** A guard hit the scorecard counts, by the model whose draft it was. */
export interface GuardHit {
  by: string;
  outcome: "dropped" | "redrafted";
}

/** One row per model, drafts that reached him first, most drafts first. */
export function scoreArms(
  drafts: readonly ScoredDraft[],
  guard: readonly GuardHit[] = [],
): ArmRow[] {
  const rows = new Map<string, ArmRow & { chars: number[]; shares: number[] }>();
  const row = (by: string, armed: boolean) => {
    const key = `${armed ? "arm" : "other"}:${by}`;
    let r = rows.get(key);
    if (!r) {
      r = {
        by,
        armed,
        label: armed ? armLabel(by) : `${armLabel(by)}, outside the test`,
        generated: 0,
        approvedUnedited: 0,
        approvedEdited: 0,
        rejected: 0,
        open: 0,
        dropped: 0,
        redrafted: 0,
        editChars: null,
        editShare: null,
        proof: { live: 0, hidden: 0, missing: 0 },
        replied: 0,
        repliable: 0,
        uneditedRate: null,
        decided: 0,
        chars: [],
        shares: [],
      };
      rows.set(key, r);
    }
    return r;
  };
  for (const d of drafts) {
    const r = row(d.by, d.armed);
    r.generated++;
    if (d.end.is === "open") r.open++;
    else if (d.end.is === "rejected") r.rejected++;
    else {
      const changed = editChars(d.written, d.end.text);
      if (changed === 0) r.approvedUnedited++;
      else {
        r.approvedEdited++;
        r.chars.push(changed);
        r.shares.push(changed / Math.max(d.written.trim().length, d.end.text.trim().length, 1));
      }
      if (d.proof === "live" || d.proof === "hidden" || d.proof === "missing") r.proof[d.proof]++;
      if (d.replies !== null && d.replies !== undefined) {
        r.repliable++;
        if (d.replies > 0) r.replied++;
      }
    }
  }
  for (const g of guard) row(g.by, true)[g.outcome]++;
  return [...rows.values()]
    .map(({ chars, shares, ...r }) => {
      const decided = r.approvedUnedited + r.approvedEdited + r.rejected;
      return {
        ...r,
        editChars: mean(chars),
        editShare: mean(shares),
        decided,
        uneditedRate: decided ? r.approvedUnedited / decided : null,
      };
    })
    .sort((a, b) => b.generated + b.dropped - (a.generated + a.dropped));
}

/** Decided drafts each of two arms needs before a gap counts. */
export const MIN_DECIDED_PER_ARM = 40;
/** The unedited-approve rate gap, in percentage points, that counts as clear. */
export const MIN_GAP_POINTS = 10;

export interface Verdict {
  /** The arm ahead by a clear margin, else null. */
  winner: string | null;
  /** One sentence for the report. */
  says: string;
}

/**
 * The rule: with at least MIN_DECIDED_PER_ARM decided drafts on each of the two arms with the
 * most, the one with the higher unedited-approve rate wins if it leads by MIN_GAP_POINTS or more.
 * It says so and nothing else: no model is switched.
 */
export function verdict(rows: readonly ArmRow[]): Verdict {
  const live = rows
    .filter((r) => r.armed && r.decided > 0)
    .sort((a, b) => b.decided - a.decided)
    .slice(0, 2);
  const [a, b] = live;
  if (!a || !b)
    return { winner: null, says: "Not enough yet: the test needs two models with decided drafts." };
  const short = [a, b].filter((r) => r.decided < MIN_DECIDED_PER_ARM);
  if (short.length)
    return {
      winner: null,
      says: `Too early: ${short.map((r) => `${r.label} has ${r.decided}`).join(", ")} decided, ${MIN_DECIDED_PER_ARM} needed on each.`,
    };
  const [hi, lo] = (a.uneditedRate ?? 0) >= (b.uneditedRate ?? 0) ? [a, b] : [b, a];
  const gap = ((hi.uneditedRate ?? 0) - (lo.uneditedRate ?? 0)) * 100;
  if (gap >= MIN_GAP_POINTS)
    return {
      winner: hi.by,
      says: `${hi.label} is ahead: ${pct(hi.uneditedRate)} approved unedited against ${pct(lo.uneditedRate)} for ${lo.label}, over ${hi.decided} and ${lo.decided} decided drafts. Not switched; set it with wren drafts models set.`,
    };
  return {
    winner: null,
    says: `No clear winner: ${hi.label} ${pct(hi.uneditedRate)} against ${lo.label} ${pct(lo.uneditedRate)} approved unedited (a ${MIN_GAP_POINTS} point gap is needed).`,
  };
}

const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

export interface Scorecard {
  since: string;
  arms: readonly DraftArm[];
  rows: ArmRow[];
  verdict: Verdict;
}
