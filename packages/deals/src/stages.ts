/**
 * A pipeline's stages as a person edits them: checked here, with no database, so the portal's
 * form and the store refuse the same things.
 */
import { STAGE_KINDS, type Stage, type StageKind } from "./schema.js";

/** A pipeline made for an owner on its first read. */
export const DEFAULT_PIPELINE = "Sales";
export const DEFAULT_STAGES: readonly Stage[] = [
  { key: "new", label: "New", kind: "open" },
  { key: "contacted", label: "Contacted", kind: "open" },
  { key: "booked", label: "Booked", kind: "open" },
  { key: "quoted", label: "Quoted", kind: "open" },
  { key: "won", label: "Won", kind: "won" },
  { key: "lost", label: "Lost", kind: "lost" },
];

export class StageProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StageProblem";
  }
}

const MAX_STAGES = 12;

/** "Proposal sent" as a key: "proposal_sent". */
export const keyOf = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

/**
 * Stages as typed: each needs a label; a missing key comes from it; keys and labels are unique;
 * at least one open stage, exactly one won and one lost.
 */
export function parseStages(raw: unknown): Stage[] {
  if (!Array.isArray(raw) || !raw.length) throw new StageProblem("a pipeline needs stages");
  if (raw.length > MAX_STAGES) throw new StageProblem(`${MAX_STAGES} stages at most`);
  const out: Stage[] = raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const label = String(o.label ?? "").trim();
    if (!label) throw new StageProblem("every stage needs a name");
    if (label.length > 40) throw new StageProblem(`"${label.slice(0, 20)}…" is too long`);
    const key = keyOf(String(o.key ?? "").trim() || label);
    if (!key) throw new StageProblem(`"${label}" needs a letter or a number`);
    const kind = (o.kind ?? "open") as StageKind;
    if (!STAGE_KINDS.includes(kind)) throw new StageProblem(`"${label}" has no such kind`);
    return { key, label, kind };
  });
  const dup = (f: (s: Stage) => string) =>
    out.find((s, i) => out.findIndex((t) => f(t) === f(s)) !== i);
  const twice = dup((s) => s.key) ?? dup((s) => s.label.toLowerCase());
  if (twice) throw new StageProblem(`"${twice.label}" is there twice`);
  const count = (k: StageKind) => out.filter((s) => s.kind === k).length;
  if (!count("open")) throw new StageProblem("a pipeline needs an open stage");
  if (count("won") !== 1 || count("lost") !== 1)
    throw new StageProblem("a pipeline has one won stage and one lost stage");
  return out;
}

export const stageOf = (stages: readonly Stage[], key: string): Stage | undefined =>
  stages.find((s) => s.key === key);

/** Where a new deal lands: the first open stage. */
export const firstStage = (stages: readonly Stage[]): Stage =>
  stages.find((s) => s.kind === "open") ?? (stages[0] as Stage);

/** The stage of a kind: Mark won and Mark lost move there. */
export const stageOfKind = (stages: readonly Stage[], kind: StageKind): Stage | undefined =>
  stages.find((s) => s.kind === kind);
