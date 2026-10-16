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

export interface KindSpec {
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

/** A reel, video, article or episode in Wren's Learn. The state carries `focus` (the scorer's). */
const learnWorth: KindSpec = {
  kind: "learn_worth",
  name: "Learn items",
  questions: {
    [PICK]: {
      type: "choice",
      instructions:
        "Is `item` worth the owner's time? He runs Wren, a small AI automation agency. `focus` is what Wren builds and runs.",
      criteria: {
        worth:
          "A concrete method, number or example Wren could use in `focus`. He would keep it or add it to a playbook.",
        skip: "Generic advice, hype, entertainment, or off `focus`. He would archive it unread.",
      },
    },
  },
  labels: {
    worth: { name: "Worth it", keep: true, tone: "good", about: "Worth his time" },
    skip: { name: "Skip", keep: false, tone: "neutral", about: "Not worth his time" },
  },
  defaultMode: "recommend",
  gate: false,
};

export const KINDS: Readonly<Record<DecisionKind, KindSpec>> = {
  comment_quality: commentQuality,
  learn_worth: learnWorth,
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
