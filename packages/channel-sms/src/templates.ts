/**
 * SMS copy: William writes every word. Code only declares the slots (which
 * texts exist, the fields each may use, the rules each must meet); the words
 * live in `sms_templates`, filled from the phone app or `wren sms templates
 * set`. An empty slot sends nothing: enroll refuses a sequence with an empty
 * step, and a keyword with no reply gets Telnyx's default.
 *
 * `{first_name|there}` = the field, or the fallback after the bar when it is
 * empty. A field the slot does not offer is refused at save, never a blank at
 * send. A cold opener must say how to stop, so a step 1 without "STOP" does not save.
 */

export interface SmsStep {
  /** 1-based. Step 1 is the opener. */
  step: number;
  /** Days after the previous step was sent (step 1: 0). */
  afterDays: number;
}

export interface SmsSequence {
  name: string;
  steps: readonly SmsStep[];
}

export interface RenderFields {
  first_name: string | null;
  company: string | null;
  sender: string;
}

export type RenderField = keyof RenderFields;

/** What a preview fills in, so a segment count is a real text's, not the braces'. */
export function sampleFields(sender: string): RenderFields {
  return { first_name: "Dana", company: "Northwind", sender };
}

/** One text William fills. The key is what `sms_messages.template` records. */
export interface TemplateSlot {
  key: string;
  /** What the text is for, shown above its empty box. */
  purpose: string;
  fields: readonly RenderField[];
  /** Must contain the word STOP (the first text a stranger gets). */
  mustSayStop: boolean;
  /** Fewest characters (Telnyx refuses a keyword reply under 20). */
  minLength: number;
}

const FIELD = /\{([a-z_]+)(?:\|([^}]*))?\}/g;
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
    purpose:
      s.step === 1
        ? `${seq.name}: first text, to someone who has not texted us`
        : `${seq.name}: text ${s.step}, ${s.afterDays} days after the last one`,
    fields: SEQUENCE_FIELDS,
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
  const text = body.trim();
  if (text === "") return "";
  for (const m of text.matchAll(FIELD)) {
    if (!(slot.fields as readonly string[]).includes(m[1] as string)) {
      throw new Error(
        slot.fields.length === 0
          ? `${slot.key} takes no fields: {${m[1]}} is not filled in`
          : `${slot.key}: unknown field {${m[1]}} (have: ${slot.fields.map((f) => `{${f}}`).join(", ")})`,
      );
    }
  }
  if (slot.mustSayStop && !/\bstop\b/i.test(text))
    throw new Error(`${slot.key} is a first text: it must say how to stop (the word STOP)`);
  if (text.length < slot.minLength)
    throw new Error(`${slot.key} needs at least ${slot.minLength} characters`);
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
