/**
 * SMS copy: plain data (niches own the words), rendered here with three
 * fields, and measured the way carriers bill it.
 *
 * `{first_name|there}` = the field, or the fallback after the bar when it is
 * empty. Unknown fields are an error at load, not a blank at send. A cold
 * opener must say how to stop (the first text a stranger gets), so a step 1
 * without "STOP" does not load.
 */

export interface SmsStep {
  /** 1-based. Step 1 is the opener. */
  step: number;
  /** Days after the previous step was sent (step 1: 0). */
  afterDays: number;
  body: string;
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

const FIELD = /\{([a-z_]+)(?:\|([^}]*))?\}/g;
const KNOWN: ReadonlySet<string> = new Set(["first_name", "company", "sender"]);

/** Throws on the first thing wrong with a sequence, so a bad one never reaches a send. */
export function checkSequence(seq: SmsSequence): SmsSequence {
  if (seq.steps.length === 0) throw new Error(`sms sequence ${seq.name} has no steps`);
  seq.steps.forEach((s, i) => {
    if (s.step !== i + 1) throw new Error(`sms sequence ${seq.name}: steps must be 1..n in order`);
    if (s.afterDays < 0 || (i === 0 && s.afterDays !== 0)) {
      throw new Error(`sms sequence ${seq.name} step ${s.step}: bad afterDays ${s.afterDays}`);
    }
    for (const m of s.body.matchAll(FIELD)) {
      if (!KNOWN.has(m[1] as string)) {
        throw new Error(`sms sequence ${seq.name} step ${s.step}: unknown field {${m[1]}}`);
      }
    }
  });
  if (!/\bstop\b/i.test(seq.steps[0]?.body ?? "")) {
    throw new Error(
      `sms sequence ${seq.name}: the opener must say how to stop (e.g. "reply STOP to opt out")`,
    );
  }
  return seq;
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
