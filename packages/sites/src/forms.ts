/**
 * Hosted forms (designs/2026-10-07-forms-and-pay.md): a form is data, a `spec` of fields, rules,
 * what happens after a submit and an optional booking step. The same spec renders the hosted page
 * at `/o/f/<slug>`, a Sites page's form section, and checks every submit on the server. No Node
 * here: the portal's builder reads it too.
 */
import { esc, para, safeHref } from "./templates/parts.js";

export const FIELD_KINDS = [
  "text",
  "long",
  "email",
  "phone",
  "select",
  "multi",
  "date",
  "consent",
  "hidden",
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** Rules past required and length: fixed shapes, never a free regex (it would run on our side). */
export const FIELD_RULES = ["digits", "letters", "zip", "url"] as const;
export type FieldRule = (typeof FIELD_RULES)[number];

export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  text: "Short text",
  long: "Paragraph",
  email: "Email",
  phone: "Phone",
  select: "Pick one",
  multi: "Pick any",
  date: "Date",
  consent: "Text consent",
  hidden: "Hidden (from the link)",
};
export const FIELD_RULE_LABELS: Record<FieldRule, string> = {
  digits: "Digits only",
  letters: "Letters only",
  zip: "US ZIP code",
  url: "Web address",
};

export interface FormField {
  /** The value's name in the submission and the door's payload: `email`, `service`. */
  key: string;
  kind: FieldKind;
  label: string;
  hint?: string;
  required?: boolean;
  min?: number;
  max?: number;
  rule?: FieldRule;
  /** Pick one, pick any. */
  options?: string[];
}

export type FormAfter = { kind: "thanks"; text: string } | { kind: "redirect"; url: string };

export interface FormSpec {
  title: string;
  intro?: string;
  button: string;
  fields: FormField[];
  after: FormAfter;
  /** After the thanks: "Pick a time" to this booking page, name and email carried along. */
  booking?: { url: string; label?: string } | null;
}

/** The consent box's key: the door reads it (`HOOK_PRESETS.site`) and only a "yes" counts. */
export const CONSENT_KEY = "sms_consent";
export const FIELDS_MAX = 30;
export const OPTIONS_MAX = 30;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
/** Never a field: the kit's own and the trap. */
const RESERVED = new Set(["page", "form", "view", "website", "cf_turnstile_response"]);
/** The longest any value is kept. */
export const VALUE_MAX = 2000;

/** TCPA wording for a text opt-in, with the business named. Kept with each submit, by version. */
export const consentWords = (business: string) =>
  `I agree to get texts from ${business.trim() || "us"} at the number above, including marketing texts sent by automated means. Consent is not a condition of purchase. Msg and data rates may apply. Msg frequency varies. Reply STOP to stop, HELP for help.`;

/** A new form's starting point: name, email, phone, a note, consent, and the utm it came with. */
export function defaultSpec(business: string): FormSpec {
  return {
    title: "Get in touch",
    intro: "Leave your details and we'll get back to you today.",
    button: "Send",
    fields: [
      { key: "name", kind: "text", label: "Name", required: true, max: 120 },
      { key: "email", kind: "email", label: "Email", required: true },
      { key: "phone", kind: "phone", label: "Phone" },
      { key: "note", kind: "long", label: "Anything we should know", max: 1000 },
      { key: CONSENT_KEY, kind: "consent", label: consentWords(business) },
      { key: "utm_source", kind: "hidden", label: "utm_source" },
      { key: "utm_medium", kind: "hidden", label: "utm_medium" },
      { key: "utm_campaign", kind: "hidden", label: "utm_campaign" },
    ],
    after: { kind: "thanks", text: "Thanks. We got it and we'll be in touch soon." },
    booking: null,
  };
}

/** Why a spec can't be kept, in words for the builder. */
export class FormProblem extends Error {}

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const int = (v: unknown, lo: number, hi: number): number | undefined => {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n)
    ? Math.max(lo, Math.min(hi, Math.round(n)))
    : undefined;
};

/** A spec from anything (the builder's JSON, an agent's), checked; a `FormProblem` says why not. */
export function parseSpec(raw: unknown): FormSpec {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = str(r.title, 200);
  if (!title) throw new FormProblem("Give the form a title.");
  const list = Array.isArray(r.fields) ? r.fields : [];
  if (!list.length) throw new FormProblem("Add a field.");
  if (list.length > FIELDS_MAX) throw new FormProblem(`At most ${FIELDS_MAX} fields.`);
  const seen = new Set<string>();
  const fields = list.map((f, i) => fieldOf(f, i, seen));
  if (!fields.some((f) => f.kind === "email" || f.kind === "phone"))
    throw new FormProblem("Add an email or a phone field, so the lead can be reached.");
  if (fields.filter((f) => f.kind === "consent").length > 1)
    throw new FormProblem("One text consent box per form.");
  const a = (r.after && typeof r.after === "object" ? r.after : {}) as Record<string, unknown>;
  let after: FormAfter;
  if (a.kind === "redirect") {
    const url = safeHref(str(a.url, 500));
    if (!url || url.startsWith("mailto:") || url.startsWith("tel:"))
      throw new FormProblem("The redirect needs a web address or a path.");
    after = { kind: "redirect", url };
  } else after = { kind: "thanks", text: str(a.text, 500) || "Thanks. We got it." };
  const b = (r.booking && typeof r.booking === "object" ? r.booking : null) as Record<
    string,
    unknown
  > | null;
  let booking: FormSpec["booking"] = null;
  if (b && str(b.url, 500)) {
    const url = safeHref(str(b.url, 500));
    if (!url || url.startsWith("mailto:") || url.startsWith("tel:"))
      throw new FormProblem("The booking step needs a web address or a path, like /book.");
    booking = { url, ...(str(b.label, 60) ? { label: str(b.label, 60) } : {}) };
  }
  const intro = str(r.intro, 1000);
  return {
    title,
    ...(intro ? { intro } : {}),
    button: str(r.button, 60) || "Send",
    fields,
    after,
    booking,
  };
}

function fieldOf(raw: unknown, i: number, seen: Set<string>): FormField {
  const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = String(f.kind ?? "text") as FieldKind;
  if (!(FIELD_KINDS as readonly string[]).includes(kind))
    throw new FormProblem(`Field ${i + 1}: no such kind "${String(f.kind).slice(0, 20)}".`);
  const label = str(f.label, kind === "consent" ? 1000 : 200);
  const key = kind === "consent" ? CONSENT_KEY : str(f.key, 40) || keyOf(label);
  const name = label || key || `field ${i + 1}`;
  if (!KEY.test(key) || RESERVED.has(key))
    throw new FormProblem(
      `"${name}": its key must start with a letter and hold only a-z, 0-9 and _.`,
    );
  if (seen.has(key)) throw new FormProblem(`Two fields share the key "${key}".`);
  seen.add(key);
  if (!label && kind !== "hidden") throw new FormProblem(`Field ${i + 1} needs a label.`);
  const out: FormField = { key, kind, label: label || key };
  const hint = str(f.hint, 200);
  if (hint) out.hint = hint;
  if (f.required === true && kind !== "hidden") out.required = true;
  if (kind === "text" || kind === "long") {
    const min = int(f.min, 0, VALUE_MAX);
    const max = int(f.max, 1, VALUE_MAX);
    if (min !== undefined && min > 0) out.min = min;
    if (max !== undefined) out.max = max;
    if (out.min !== undefined && out.max !== undefined && out.min > out.max)
      throw new FormProblem(`"${name}": the least is more than the most.`);
    const rule = f.rule ? String(f.rule) : "";
    if (rule) {
      if (!(FIELD_RULES as readonly string[]).includes(rule))
        throw new FormProblem(`"${name}": no such rule "${rule.slice(0, 20)}".`);
      out.rule = rule as FieldRule;
    }
  }
  if (kind === "select" || kind === "multi") {
    const opts = (Array.isArray(f.options) ? f.options : String(f.options ?? "").split("\n"))
      .map((o) => str(o, 80))
      .filter(Boolean);
    const options = [...new Set(opts)];
    if (!options.length) throw new FormProblem(`"${name}": add at least one choice.`);
    if (options.length > OPTIONS_MAX)
      throw new FormProblem(`"${name}": at most ${OPTIONS_MAX} choices.`);
    out.options = options;
  }
  return out;
}

/** A key from a label: "Best time to call" -> "best_time_to_call". */
export function keyOf(label: string): string {
  const k = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/, "");
  return /^[a-z]/.test(k) ? k : k ? `f_${k}`.slice(0, 40) : "";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RULE_TESTS: Record<FieldRule, [RegExp, string]> = {
  digits: [/^\d+$/, "Use digits only."],
  letters: [/^[\p{L} .'-]+$/u, "Use letters only."],
  zip: [/^\d{5}(-\d{4})?$/, "Use a 5-digit ZIP code."],
  url: [/^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i, "Use a web address."],
};

export interface Checked {
  /** Every field's value as kept: multi joined by ", ", consent "yes" or left out. */
  values: Record<string, string>;
  /** Per field key, what's wrong, said to the visitor. Empty when it may be kept. */
  errors: Record<string, string>;
}

/** One value as sent: a string, or for pick-any a list (or a comma list). */
function rawOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return typeof v === "string" ? [v] : [];
}

/** A submit checked against its spec, on the server; the browser checks the same first. */
export function checkEntry(spec: FormSpec, raw: Record<string, unknown>): Checked {
  const values: Record<string, string> = {};
  const errors: Record<string, string> = {};
  for (const f of spec.fields) {
    const got = rawOf(raw[f.key]).map((s) => s.trim());
    const one = (got[0] ?? "").slice(0, VALUE_MAX);
    const bad = (why: string) => {
      errors[f.key] = why;
    };
    if (f.kind === "consent") {
      if (one === "yes" || one === "on" || one === "true") values[f.key] = "yes";
      else if (f.required) bad("Tick the box to go on.");
      continue;
    }
    if (f.kind === "multi") {
      const picked = got
        .flatMap((s) => (got.length === 1 ? s.split(",") : [s]))
        .map((s) => s.trim())
        .filter(Boolean);
      const known = picked.filter((p) => f.options?.includes(p));
      if (known.length !== picked.length) bad("Pick from the list.");
      else if (known.length) values[f.key] = [...new Set(known)].join(", ");
      else if (f.required) bad("Pick at least one.");
      continue;
    }
    if (!one) {
      if (f.required) bad("Fill this in.");
      continue;
    }
    if (f.kind === "hidden") {
      values[f.key] = one.slice(0, 200);
      continue;
    }
    if (f.kind === "email" && !EMAIL.test(one)) bad("That email doesn't look right.");
    else if (f.kind === "phone") {
      const digits = one.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 15 || /[^\d\s()+.-]/.test(one))
        bad("That phone number doesn't look right.");
    } else if (f.kind === "date") {
      const m = DATE.exec(one);
      const d = m ? new Date(`${one}T00:00:00Z`) : null;
      if (!m || !d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== one)
        bad("Pick a date.");
    } else if (f.kind === "select" && !f.options?.includes(one)) bad("Pick from the list.");
    else if (f.min !== undefined && one.length < f.min) bad(`At least ${f.min} characters.`);
    else if (f.max !== undefined && one.length > f.max) bad(`At most ${f.max} characters.`);
    else if (f.rule && !RULE_TESTS[f.rule][0].test(one)) bad(RULE_TESTS[f.rule][1]);
    if (!errors[f.key]) values[f.key] = one;
  }
  const reach = spec.fields.filter((f) => f.kind === "email" || f.kind === "phone");
  if (!Object.keys(errors).length && !reach.some((f) => values[f.key])) {
    const first = reach[0];
    if (first) errors[first.key] = "Add an email or a phone number.";
  }
  return { values, errors };
}

/** The consent words a spec shows, or null when it has no box. */
export const consentOf = (spec: FormSpec): string | null =>
  spec.fields.find((f) => f.kind === "consent")?.label ?? null;

/** Where a form posts and what it's counted under. */
export interface FormContext {
  /** The form's id: posts and events carry it. */
  form: string;
  /** The page it sits on, when it's a page's section. */
  page?: string | null;
  /** The host the post goes to: "" for its own. */
  base: string;
}

const AUTOCOMPLETE: Partial<Record<string, string>> = {
  name: "name",
  first_name: "given-name",
  last_name: "family-name",
  email: "email",
  phone: "tel",
  company: "organization",
  zip: "postal-code",
};

function fieldHtml(f: FormField, id: string): string {
  const req = f.required ? " required" : "";
  const hint = f.hint ? `<small>${esc(f.hint)}</small>` : "";
  const words = `${esc(f.label)}${f.required ? "" : ' <span class="opt">(optional)</span>'}`;
  // One grid row: the label's words and "(optional)" stay on a line together.
  const label = `<span>${words}</span>`;
  const auto = AUTOCOMPLETE[f.key] ? ` autocomplete="${AUTOCOMPLETE[f.key]}"` : "";
  const len = `${f.min ? ` minlength="${f.min}"` : ""} maxlength="${f.max ?? (f.kind === "long" ? 2000 : 200)}"`;
  switch (f.kind) {
    case "hidden":
      return `<input type="hidden" name="${esc(f.key)}" data-q="${esc(f.key)}">`;
    case "consent":
      return `<label class="check"><input type="checkbox" name="${esc(f.key)}" value="yes"${req}> <span>${esc(f.label)}</span></label>`;
    case "long":
      return `<label for="${id}">${label}${hint}<textarea id="${id}" name="${esc(f.key)}" rows="3"${len}${req}></textarea></label>`;
    case "select":
      return `<label for="${id}">${label}${hint}<select id="${id}" name="${esc(f.key)}"${req}><option value="">Pick one</option>${(f.options ?? []).map((o) => `<option>${esc(o)}</option>`).join("")}</select></label>`;
    case "multi":
      return `<fieldset class="multi"${f.required ? " data-required" : ""}><legend>${words}</legend>${hint}${(f.options ?? []).map((o) => `<label class="check"><input type="checkbox" name="${esc(f.key)}" value="${esc(o)}"> <span>${esc(o)}</span></label>`).join("")}</fieldset>`;
    case "date":
      return `<label for="${id}">${label}${hint}<input id="${id}" type="date" name="${esc(f.key)}"${req}></label>`;
    case "email":
      return `<label for="${id}">${label}${hint}<input id="${id}" type="email" name="${esc(f.key)}" autocomplete="email" maxlength="200"${req}></label>`;
    case "phone":
      return `<label for="${id}">${label}${hint}<input id="${id}" type="tel" name="${esc(f.key)}" autocomplete="tel" maxlength="40"${req}></label>`;
    default: {
      const pattern =
        f.rule === "digits"
          ? ' inputmode="numeric"'
          : f.rule === "zip"
            ? ' inputmode="numeric"'
            : "";
      return `<label for="${id}">${label}${hint}<input id="${id}" name="${esc(f.key)}"${auto}${pattern}${len}${req}></label>`;
    }
  }
}

/**
 * The form itself, for the hosted page and a Sites page's section alike. Posts without script
 * too; the kit sends it as JSON, runs Turnstile, counts the start and shows the answer.
 */
export function formHtml(spec: FormSpec, ctx: FormContext): string {
  const after =
    spec.after.kind === "redirect"
      ? ` data-redirect="${esc(spec.after.url)}"`
      : ` data-thanks="${esc(spec.after.text)}"`;
  const booking = spec.booking
    ? ` data-booking="${esc(spec.booking.url)}" data-booking-label="${esc(spec.booking.label ?? "Pick a time")}"`
    : "";
  const fields = spec.fields
    .map((f, i) => fieldHtml(f, `f-${ctx.form.slice(0, 8)}-${i}`))
    .join("\n");
  return `<form method="post" action="${esc(ctx.base)}/o/__form" data-wren-form data-form="${esc(ctx.form)}"${after}${booking} novalidate>
<input type="hidden" name="form" value="${esc(ctx.form)}">
${ctx.page ? `<input type="hidden" name="page" value="${esc(ctx.page)}">` : ""}
${fields}
<label class="trap" aria-hidden="true">Leave empty<input name="website" tabindex="-1" autocomplete="off"></label>
<button type="submit">${esc(spec.button)}</button>
<p class="sent" role="status" hidden></p>
</form>`;
}

/** The form's heading and intro over the form. */
export const formIntro = (spec: FormSpec, h: "h1" | "h2") =>
  `<${h}>${esc(spec.title)}</${h}>\n${spec.intro ? `<p class="muted">${para(spec.intro)}</p>` : ""}`;
