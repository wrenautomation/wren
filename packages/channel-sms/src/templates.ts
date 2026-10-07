/**
 * SMS copy: William writes every word. Code only declares the slots (which
 * texts exist, the fields each may use, the rules each must meet); the words
 * live in `sms_templates`, filled from the phone app or `wren sms templates
 * set`. An empty slot sends nothing: enroll refuses a sequence with an empty
 * step, a keyword with no reply gets Telnyx's default, and an empty reminder
 * means no reminders.
 *
 * `{first_name|there}` = the field, or the fallback after the bar when it is
 * empty. A field the slot does not offer is refused at save, never a blank at
 * send. A cold opener must say how to stop, so a step 1 without "STOP" does not save.
 * The syntax, its check and its render are every channel's (`@wren/core/slots`),
 * so a text can carry `[[variants]]` and `((groups))` as an email does.
 */
import {
  checkSource,
  parseKind,
  type RenderProvenance,
  renderKind,
  type Template,
} from "@wren/core/slots";

export interface SmsStep {
  /** 1-based. Step 1 is the opener. */
  step: number;
  /** Days after the previous step was sent (step 1: 0). */
  afterDays: number;
}

export interface SmsSequence {
  name: string;
  /** What William reads for it ("Applicant who fits"). Unset = its name. */
  label?: string;
  steps: readonly SmsStep[];
  /** When the first text goes, shown beside it. Unset = a cold first text. */
  firstGoes?: string;
  /** The fields its texts may use. Unset = all of them. */
  fields?: readonly RenderField[];
}

export interface RenderFields {
  first_name: string | null;
  company: string | null;
  sender: string;
  /** A reminder's call time on the person's own clock ("2:30 PM"); null in a sequence. */
  time: string | null;
}

export type RenderField = keyof RenderFields;

/** What a preview fills in, so a segment count is a real text's, not the braces'. */
export function sampleFields(sender: string): RenderFields {
  return { first_name: "Dana", company: "Northwind", sender, time: "2:30 PM" };
}

/** One text William fills. The key is what `sms_messages.template` records. */
export interface TemplateSlot {
  key: string;
  /** What the text is for, its title. */
  purpose: string;
  /** When it goes, shown beside it. */
  goes?: string;
  fields: readonly RenderField[];
  /** Must contain the word STOP (the first text a stranger gets). */
  mustSayStop: boolean;
  /** Fewest characters (Telnyx refuses a keyword reply under 20). */
  minLength: number;
}

const SEQUENCE_FIELDS: readonly RenderField[] = ["first_name", "company", "sender"];

export const KEYWORDS = ["help", "start", "stop"] as const;
export type Keyword = (typeof KEYWORDS)[number];

/**
 * The words each reply answers, as registered on the 10DLC campaign (plus the
 * carriers' standard opt-out set). Telnyx answers a bare YES with the start
 * reply too, so that text has to read fine after any "yes".
 */
export const KEYWORD_WORDS: Record<Keyword, readonly string[]> = {
  help: ["HELP", "INFO"],
  start: ["START", "YES", "UNSTOP"],
  stop: ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"],
};

/** Telnyx sends these itself, on the messaging profile: no fields. */
export const KEYWORD_SLOTS: readonly TemplateSlot[] = [
  { key: "keyword.help", purpose: "Auto reply to HELP or INFO" },
  { key: "keyword.start", purpose: "Auto reply to START or YES (opting back in)" },
  { key: "keyword.stop", purpose: "Auto reply to STOP and the other opt-out words" },
].map((s) => ({ ...s, fields: [], mustSayStop: false, minLength: 20 }));

/** The day before a booked call, to someone who ticked the texts box when they applied. */
export const DAY_BEFORE = "reminder.day-before";
/** About an hour before it, the same people. Empty until William writes it: no texts. */
export const HOUR_BEFORE = "reminder.hour-before";

export const REMINDER_SLOTS: readonly TemplateSlot[] = [
  {
    key: DAY_BEFORE,
    purpose: "Reminder the day before a booked call",
    goes: "The day before, in texting hours on their clock, to people who ticked the texts box",
    fields: ["first_name", "time", "sender"],
    mustSayStop: false,
    minLength: 1,
  },
  {
    key: HOUR_BEFORE,
    purpose: "Reminder about an hour before a booked call",
    goes: "30 to 90 minutes before, in texting hours on their clock, to people who ticked the texts box",
    fields: ["first_name", "time", "sender"],
    mustSayStop: false,
    minLength: 1,
  },
];

export function keywordOf(key: string): Keyword | null {
  const op = key.startsWith("keyword.") ? key.slice("keyword.".length) : "";
  return (KEYWORDS as readonly string[]).includes(op) ? (op as Keyword) : null;
}

export function stepKey(sequence: string, step: number): string {
  return `${sequence}#${step}`;
}

export function sequenceSlots(seq: SmsSequence): TemplateSlot[] {
  return seq.steps.map((s) => ({
    key: stepKey(seq.name, s.step),
    purpose: `${seq.label ?? seq.name}: ${s.step === 1 ? "first text" : `text ${s.step}`}`,
    goes:
      s.step === 1
        ? (seq.firstGoes ?? "First, to someone who has not texted us")
        : `${s.afterDays} ${s.afterDays === 1 ? "day" : "days"} after the last one`,
    fields: seq.fields ?? SEQUENCE_FIELDS,
    mustSayStop: s.step === 1,
    minLength: 1,
  }));
}

/** Throws on the first thing wrong with a sequence's shape, so a bad one never loads. */
export function checkSequence(seq: SmsSequence): SmsSequence {
  if (seq.steps.length === 0) throw new Error(`sms sequence ${seq.name} has no steps`);
  seq.steps.forEach((s, i) => {
    if (s.step !== i + 1) throw new Error(`sms sequence ${seq.name}: steps must be 1..n in order`);
    if (s.afterDays < 0 || (i === 0 && s.afterDays !== 0)) {
      throw new Error(`sms sequence ${seq.name} step ${s.step}: bad afterDays ${s.afterDays}`);
    }
  });
  return seq;
}

/** The body as it will be stored ("" clears the slot), or throws saying what is wrong. */
export function checkBody(slot: TemplateSlot, body: string): string {
  return checkSource("sms", slot.key, body, slot)?.source ?? "";
}

export interface RenderedText {
  body: string;
  /** What `sms_messages.provenance` keeps: the version, the seed and each variant's pick. */
  provenance: RenderProvenance;
}

/** One person's text. The seed is who it's for, so their variant picks never move. */
export function render(tpl: Template, fields: RenderFields, seed: string): RenderedText {
  const out = renderKind("sms", tpl, { ...fields }, seed);
  return { body: out.body, provenance: out.provenance };
}

/** Unsaved words as a text reads, for an editor's preview; throws as a save would. */
export const preview = (source: string, fields: RenderFields): string =>
  render(parseKind("sms", "preview", source), fields, "sample").body;

/** The seed a contact's texts pick their variants by. */
export const textSeed = (contactId: number) => `sms:${contactId}`;

/** A first name from a person's full name: the first word, only when it reads as a name. */
export function firstName(full: string | null | undefined): string | null {
  const word = full?.trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-z][A-Za-z'-]{1,}$/.test(word) ? word[0]?.toUpperCase() + word.slice(1) : null;
}

// GSM 03.38 basic set; the extension set costs two septets each.
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€\f";

export interface Segments {
  encoding: "GSM-7" | "UCS-2";
  /** Characters as the encoding counts them (septets for GSM-7, UTF-16 units for UCS-2). */
  units: number;
  parts: number;
}

/** How many billed parts a text is: 160/153 septets in GSM-7, 70/67 units once any character needs UCS-2. */
export function segments(text: string): Segments {
  let septets = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) septets += 1;
    else if (GSM_EXTENDED.includes(ch)) septets += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    return {
      encoding: "GSM-7",
      units: septets,
      parts: septets <= 160 ? 1 : Math.ceil(septets / 153),
    };
  }
  const units = text.length;
  return { encoding: "UCS-2", units, parts: units <= 70 ? 1 : Math.ceil(units / 67) };
}
