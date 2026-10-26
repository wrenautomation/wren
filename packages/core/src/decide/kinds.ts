/**
 * Each kind of decision: the questions it asks, its labels, and which labels mean "kept". Plain
 * data, so the portal, the CLI and the loop read one list. A new kind is an entry here and in
 * `DECISION_KINDS` (`decide-schema.ts`).
 */
import type { ChoiceResponse, Questions } from "@typesafe-ai/sdk";
import {
  DECIDE_MODES,
  DECISION_KINDS,
  type DecideMode,
  type DecisionKind,
} from "../decide-schema.js";

export { DECIDE_MODES, DECISION_KINDS, type DecideMode, type DecisionKind };

export type Tone = "good" | "warn" | "bad" | "neutral";

export interface LabelSpec {
  /** As people read it: "Send". */
  name: string;
  keep: boolean;
  tone: Tone;
  about: string;
}

interface KindSpec {
  kind: DecisionKind;
  /** As people read it. */
  name: string;
  /** The one choice question every kind asks, under this id. */
  questions: Questions;
  labels: Readonly<Record<string, LabelSpec>>;
  /** The mode before William sets one. */
  defaultMode: DecideMode;
  /** A gate filter is built for this kind; without one, `gate` is refused. */
  gate: boolean;
}

/** The question id every kind answers its label under. */
export const PICK = "pick";

/** Comments we drafted: on a Reddit thread, on someone's post, or an answer on our own post. */
const commentQuality: KindSpec = {
  kind: "comment_quality",
  name: "Comment drafts",
  questions: {
    [PICK]: {
      type: "choice",
      instructions:
        "`draft` is a comment Wren (a small AI automation agency) drafted in reply to `post` (and `comment`, when there is one). Would the owner send it as written, send it after edits, or drop it?",
      criteria: {
        send: "On topic, adds a real fact or a useful point, sounds like one person talking, no pitch. Good to post as is.",
        edit: "Worth posting, but the words need work: too long, off tone, a wrong detail, a weak first line.",
        drop: "Not worth posting: generic, salesy, off topic, wrong, or the thread isn't worth a reply.",
      },
    },
  },
  labels: {
    send: { name: "Send", keep: true, tone: "good", about: "Good to send as is" },
    edit: { name: "Edit", keep: true, tone: "warn", about: "Worth sending after edits" },
    drop: { name: "Drop", keep: false, tone: "bad", about: "Not worth sending" },
  },
  defaultMode: "recommend",
  gate: false,
};

/**
 * A read piece (designs/2026-10-25-ingestion-engine.md): a reel, video, article or episode in
 * Wren's Learn. His keep, tune or drop on the whole piece; a star, a pin, a save or an SOP add is
 * a keep and an archive a drop. The machine says only keep or drop. The state carries `focus`.
 */
const documentKind: KindSpec = {
  kind: "document",
  name: "Documents",
  questions: {
    [PICK]: {
      type: "choice",
      instructions:
        "Is `item` worth the owner's time? He runs Wren, a small AI automation agency. `focus` is what Wren builds and runs.",
      criteria: {
        keep: "A concrete method, number or example Wren could use in `focus`. He would keep it or add it to a playbook.",
        drop: "Generic advice, hype, entertainment, or off `focus`. He would archive it unread.",
      },
    },
  },
  labels: {
    keep: { name: "Keep", keep: true, tone: "good", about: "Worth his time" },
    tune: { name: "Tune", keep: true, tone: "warn", about: "Worth it, with a change" },
    drop: { name: "Drop", keep: false, tone: "neutral", about: "Not worth his time" },
  },
  defaultMode: "recommend",
  gate: false,
};

/**
 * A person in People (designs/2026-10-17-people-depth.md): a lead for Wren's offers, or someone
 * who likes the content. The state carries `offers` (what Wren sells), what they do, the touches
 * and what research found; never a name or a handle. `unsure` is not kept: it is no lead yet.
 */
const leadFit: KindSpec = {
  kind: "lead_fit",
  name: "Lead checks",
  questions: {
    [PICK]: {
      type: "choice",
      instructions:
        "Is this person a viable lead for `offers`, sold by Wren (a small AI automation agency)? `person` is what we know they do, `touches` what they did with our posts and messages, `found` what research found about them.",
      criteria: {
        fit: "Runs or decides for a business that could buy one of `offers`: an owner, a partner, a leader at a firm of the right kind and size.",
        unsure: "Could be a buyer, but what we hold is too thin to say.",
        not: "A fan, a student, a peer selling the same thing, a job seeker, a bot: someone who likes the content and would not buy.",
      },
    },
  },
  labels: {
    fit: { name: "Lead", keep: true, tone: "good", about: "A viable lead" },
    unsure: { name: "Unsure", keep: false, tone: "warn", about: "Too little to say" },
    not: {
      name: "Not a lead",
      keep: false,
      tone: "neutral",
      about: "Likes the content, won't buy",
    },
  },
  defaultMode: "recommend",
  gate: false,
};

/**
 * One finding on a document (designs/2026-10-25-ingestion-engine.md): a hook, a beat, a call to
 * action, a post's shape, a film's shot. His call says whether Wren's own pieces should do the
 * same: keep it, tune it (keep, with a change he names), or drop it. Only he is asked today
 * (`off`): the machine learns the rules from his calls, it does not make them.
 */
const finding: KindSpec = {
  kind: "finding",
  name: "Findings",
  questions: {
    [PICK]: {
      type: "choice",
      instructions:
        "`fact` is one part of how a competitor's piece is made (its hook, a beat, its call to action, a shot). Should Wren's own pieces do the same? `focus` is what Wren makes.",
      criteria: {
        keep: "Wren's pieces should do this as it is.",
        tune: "Worth doing, with a change: the owner would say what.",
        drop: "Wren's pieces should not do this.",
      },
    },
  },
  labels: {
    keep: { name: "Keep", keep: true, tone: "good", about: "Do this" },
    tune: { name: "Tune", keep: true, tone: "warn", about: "Do this, with a change" },
    drop: { name: "Drop", keep: false, tone: "bad", about: "Never do this" },
  },
  defaultMode: "off",
  gate: false,
};

export const KINDS: Readonly<Record<DecisionKind, KindSpec>> = {
  comment_quality: commentQuality,
  document: documentKind,
  lead_fit: leadFit,
  finding,
};

export const isDecisionKind = (k: string): k is DecisionKind =>
  (DECISION_KINDS as readonly string[]).includes(k);
export const isDecideMode = (m: string): m is DecideMode =>
  (DECIDE_MODES as readonly string[]).includes(m);

/** A label's side: kept or not. Throws on a label the kind doesn't have. */
export function keepOf(kind: DecisionKind, label: string): boolean {
  const l = KINDS[kind].labels[label];
  if (!l) throw new Error(`${kind} has no label ${label}`);
  return l.keep;
}

/** The machine's label from its answers: the pick, the chance it is kept, and its confidence. */
export function machineLabel(
  kind: DecisionKind,
  answers: Record<string, unknown>,
): { label: string; p: number; confidence: number | null } | null {
  const a = answers[PICK] as Partial<ChoiceResponse> | undefined;
  if (a?.type !== "choice" || typeof a.choice !== "string" || !a.probabilities) return null;
  const labels = KINDS[kind].labels;
  if (!labels[a.choice]) return null;
  const probs = a.probabilities as Record<string, number>;
  const p = Object.entries(probs).reduce((n, [l, v]) => n + (labels[l]?.keep ? Number(v) : 0), 0);
  return {
    label: a.choice,
    p: Math.round(p * 1000) / 1000,
    confidence: typeof a.confidence === "number" ? a.confidence : null,
  };
}

/** Agreement a kind needs before a gate is offered (William, 2026-10-16). */
export const GATE_AT = { rate: 0.95, calls: 200 } as const;
