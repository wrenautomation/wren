/**
 * Outreach copy: William writes every word. Code declares the slots (which
 * messages exist, the fields each may use); the words live in
 * `reach_templates`. An empty slot sends nothing: enroll refuses a sequence
 * with an empty step, and a LinkedIn invite with no note goes without one.
 *
 * `{first_name|there}` = the field, or the fallback after the bar when it is
 * empty. A field the slot does not offer is refused at save, never a blank
 * at send.
 */
import type { Platform } from "./schema.js";

export interface ReachStep {
  /** 1-based. Step 1 is the opener. */
  step: number;
  /** Days after the previous step went (step 1: 0; on LinkedIn, after the invite was accepted). */
  afterDays: number;
  /** Reddit: the private message's subject line slot exists too. */
  subject?: boolean;
}

export interface ReachSequence {
  name: string;
  platform: Platform;
  steps: readonly ReachStep[];
  /** LinkedIn: send an invite first, message once connected. */
  connectFirst: boolean;
  /** Days to wait for an invite to be accepted before the contact is `unreachable`. */
  connectWaitDays: number;
}

export interface RenderFields {
  first_name: string | null;
  company: string | null;
  /** What their page said they do now (headline or current role). */
  headline: string | null;
  /** Where we saw them (`r/startups`). */
  found_in: string | null;
  sender: string;
}
export type RenderField = keyof RenderFields;

export function sampleFields(sender: string): RenderFields {
  return {
    first_name: "Dana",
    company: "Northwind",
    headline: "Founder at Northwind Search",
    found_in: "r/recruiting",
    sender,
  };
}

export interface TemplateSlot {
  key: string;
  platform: Platform;
  purpose: string;
  fields: readonly RenderField[];
  maxLength: number;
}

const FIELD = /\{([a-z_]+)(?:\|([^}]*))?\}/g;
const ALL_FIELDS: readonly RenderField[] = [
  "first_name",
  "company",
  "headline",
  "found_in",
  "sender",
];
/** LinkedIn's note cap; a Reddit PM is long enough for anyone. */
const NOTE_MAX = 200;
export const MESSAGE_MAX = 2000;
const SUBJECT_MAX = 100;

export const CONNECT_NOTE = "linkedin:connect-note";

/** The sequences this scaffold ships. Niche registries may add theirs later. */
export const REACH_SEQUENCES: ReadonlyMap<string, ReachSequence> = new Map(
  (
    [
      {
        name: "reddit-dm",
        platform: "reddit",
        connectFirst: false,
        connectWaitDays: 0,
        steps: [
          { step: 1, afterDays: 0, subject: true },
          { step: 2, afterDays: 5 },
        ],
      },
      {
        name: "linkedin-connect",
        platform: "linkedin",
        connectFirst: true,
        connectWaitDays: 21,
        steps: [
          { step: 1, afterDays: 1 },
          { step: 2, afterDays: 6 },
        ],
      },
    ] satisfies ReachSequence[]
  ).map((s) => [s.name, s]),
);

export const stepKey = (seq: ReachSequence, step: number) => `${seq.platform}:${seq.name}#${step}`;
export const subjectKey = (seq: ReachSequence, step: number) => `${stepKey(seq, step)}.subject`;

export function sequenceSlots(seq: ReachSequence): TemplateSlot[] {
  return seq.steps.flatMap((st) => {
    const body: TemplateSlot = {
      key: stepKey(seq, st.step),
      platform: seq.platform,
      purpose:
        st.step === 1
          ? seq.connectFirst
            ? `${seq.name}: first message, ${st.afterDays} day(s) after they accept`
            : `${seq.name}: the opener`
          : `${seq.name}: step ${st.step}, ${st.afterDays} days after step ${st.step - 1}`,
      fields: ALL_FIELDS,
      maxLength: MESSAGE_MAX,
    };
    return st.subject
      ? [
          {
            key: subjectKey(seq, st.step),
            platform: seq.platform,
            purpose: `${seq.name}: step ${st.step}'s subject line`,
            fields: ALL_FIELDS,
            maxLength: SUBJECT_MAX,
          },
          body,
        ]
      : [body];
  });
}

export const CONNECT_SLOT: TemplateSlot = {
  key: CONNECT_NOTE,
  platform: "linkedin",
  purpose: "The note on a LinkedIn invite (optional; empty = invite with no note)",
  fields: ALL_FIELDS,
  maxLength: NOTE_MAX,
};

/** Every slot: each sequence's steps, then the invite note. */
export function slotsOf(sequences: Iterable<ReachSequence>): TemplateSlot[] {
  return [...[...sequences].flatMap(sequenceSlots), CONNECT_SLOT];
}

/** The body as saved: trimmed, within length, every field one the slot offers. "" = empty. */
export function checkBody(slot: TemplateSlot, body: string): string {
  const text = body.trim();
  if (!text) return "";
  for (const m of text.matchAll(FIELD)) {
    const name = m[1] as string;
    if (!(slot.fields as readonly string[]).includes(name))
      throw new Error(`${slot.key} cannot use {${name}}; it has ${slot.fields.join(", ")}`);
  }
  if (text.length > slot.maxLength)
    throw new Error(`${slot.key} is ${text.length} characters; at most ${slot.maxLength}`);
  return text;
}

export function render(body: string, fields: RenderFields): string {
  return body
    .replace(FIELD, (_all, name: string, fallback: string | undefined) => {
      const value = (fields as unknown as Record<string, string | null>)[name]?.trim();
      if (value) return value;
      if (fallback !== undefined) return fallback;
      throw new Error(`no value for {${name}} and no fallback`);
    })
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** A first name from a full name: the first word, only when it reads as a name. */
export function firstName(full: string | null | undefined): string | null {
  const word = full?.trim().split(/\s+/)[0] ?? "";
  return /^[A-Z][a-z'’-]{1,}$/.test(word) ? word : null;
}
