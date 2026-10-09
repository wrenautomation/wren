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
  "step",
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
  step: "New step",
};

/** A show-when rule's test on the earlier field it names. */
export const SHOW_OPS = ["is", "not", "filled", "empty"] as const;
export type ShowOp = (typeof SHOW_OPS)[number];
export const SHOW_OP_LABELS: Record<ShowOp, string> = {
  is: "is",
  not: "is not",
  filled: "is filled in",
  empty: "is empty",
};

/** Shown only when an earlier field passes: `service` is "Repair", `phone` is filled in. */
export interface ShowRule {
  key: string;
  op: ShowOp;
  /** For `is` and `not`: any one matches, in any case. */
  values?: string[];
}
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
  /** Asked only when this holds; hidden, it isn't required and its value isn't kept. */
  show?: ShowRule;
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
/** Steps past the first: a form has at most 10. */
export const STEPS_MAX = 9;
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
  fields.forEach((f, i) => {
    const show = showOf((list[i] as Record<string, unknown> | null)?.show, f, fields.slice(0, i));
    if (show) f.show = show;
  });
  stepsCheck(fields);
  if (!fields.some((f) => (f.kind === "email" || f.kind === "phone") && !f.show))
    throw new FormProblem(
      "Add an email or a phone field that's always asked, so the lead can be reached.",
    );
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
  if (kind === "step") {
    // A step's key is its place: it never holds a value.
    const key = `step_${i + 1}`;
    if (seen.has(key)) throw new FormProblem(`Two fields share the key "${key}".`);
    seen.add(key);
    return { key, kind, label };
  }
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

/** A field's show-when rule, checked against the fields above it; none when not given. */
function showOf(raw: unknown, f: FormField, above: FormField[]): ShowRule | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const key = str(r.key, 40);
  if (!key) return undefined;
  const name = f.label || f.key;
  if (f.kind === "step" || f.kind === "hidden")
    throw new FormProblem(
      `"${name}": a ${FIELD_KIND_LABELS[f.kind].toLowerCase()} can't have a show rule.`,
    );
  const src = above.find((a) => a.key === key && a.kind !== "step");
  if (!src) throw new FormProblem(`"${name}": its show rule must name a field above it.`);
  const op = String(r.op ?? "") as ShowOp;
  if (!(SHOW_OPS as readonly string[]).includes(op))
    throw new FormProblem(`"${name}": no such show test "${op.slice(0, 20)}".`);
  if (op === "filled" || op === "empty") return { key, op };
  const vals = (Array.isArray(r.values) ? r.values : String(r.values ?? "").split("\n"))
    .map((v) => str(v, 80))
    .filter(Boolean);
  const values = [...new Set(vals)].slice(0, OPTIONS_MAX);
  if (!values.length) throw new FormProblem(`"${name}": say which answer shows it.`);
  if (src.options) {
    const odd = values.find((v) => !src.options?.some((o) => o.toLowerCase() === v.toLowerCase()));
    if (odd) throw new FormProblem(`"${name}": "${odd}" isn't a choice of "${src.label}".`);
  }
  return { key, op, values };
}

/** Steps split the form: never first or last, never two in a row, at most `STEPS_MAX`. */
function stepsCheck(fields: FormField[]) {
  const at = fields.flatMap((f, i) => (f.kind === "step" ? [i] : []));
  if (!at.length) return;
  if (at.length > STEPS_MAX) throw new FormProblem(`At most ${STEPS_MAX + 1} steps.`);
  // Hidden fields fill from the link, so they don't count as a step's questions.
  const asked = (i: number) => fields[i]?.kind !== "hidden" && fields[i]?.kind !== "step";
  const runs = [-1, ...at, fields.length];
  for (let n = 0; n + 1 < runs.length; n++) {
    const from = (runs[n] as number) + 1;
    const to = runs[n + 1] as number;
    let any = false;
    for (let i = from; i < to; i++) if (asked(i)) any = true;
    if (!any)
      throw new FormProblem(
        n === 0
          ? "A form can't start with a new step."
          : n === runs.length - 2
            ? "A form can't end with a new step."
            : `Step ${n + 1} has no questions.`,
      );
  }
}

/** Whether a rule holds on what its field holds now (none or hidden: nothing). */
export function shows(rule: ShowRule | undefined, got: readonly string[]): boolean {
  if (!rule) return true;
  if (rule.op === "filled") return got.length > 0;
  if (rule.op === "empty") return got.length === 0;
  const want = new Set((rule.values ?? []).map((v) => v.toLowerCase()));
  const hit = got.some((g) => want.has(g.toLowerCase()));
  return rule.op === "is" ? hit : !hit;
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
  // What each kept field holds, as a list: the show rules below it read these.
  const held: Record<string, string[]> = {};
  const shown = new Set<string>();
  for (const f of spec.fields) {
    if (f.kind === "step" || !shows(f.show, f.show ? (held[f.show.key] ?? []) : [])) continue;
    shown.add(f.key);
    checkOne(f, raw, values, errors);
    const v = values[f.key];
    if (v !== undefined)
      held[f.key] = f.kind === "multi" ? rawPicks(rawOf(raw[f.key]), f.options ?? []) : [v];
  }
  const reach = spec.fields.filter(
    (f) => (f.kind === "email" || f.kind === "phone") && shown.has(f.key),
  );
  if (!Object.keys(errors).length && !reach.some((f) => values[f.key])) {
    const first = reach.find((f) => !f.show) ?? reach[0];
    if (first) errors[first.key] = "Add an email or a phone number.";
  }
  return { values, errors };
}

/** Pick any's picks as sent: a list, or one comma list. */
function picksOf(got: string[]): string[] {
  return got
    .flatMap((s) => (got.length === 1 ? s.split(",") : [s]))
    .map((s) => s.trim())
    .filter(Boolean);
}
const rawPicks = (got: string[], options: string[]) => [
  ...new Set(picksOf(got.map((s) => s.trim())).filter((p) => options.includes(p))),
];

/** One shown field checked: its value kept, or why not. */
function checkOne(
  f: FormField,
  raw: Record<string, unknown>,
  values: Record<string, string>,
  errors: Record<string, string>,
) {
  {
    const got = rawOf(raw[f.key]).map((s) => s.trim());
    const one = (got[0] ?? "").slice(0, VALUE_MAX);
    const bad = (why: string) => {
      errors[f.key] = why;
    };
    if (f.kind === "consent") {
      if (one === "yes" || one === "on" || one === "true") values[f.key] = "yes";
      else if (f.required) bad("Tick the box to go on.");
      return;
    }
    if (f.kind === "multi") {
      const picked = picksOf(got);
      const known = picked.filter((p) => f.options?.includes(p));
      if (known.length !== picked.length) bad("Pick from the list.");
      else if (known.length) values[f.key] = [...new Set(known)].join(", ");
      else if (f.required) bad("Pick at least one.");
      return;
    }
    if (!one) {
      if (f.required) bad("Fill this in.");
      return;
    }
    if (f.kind === "hidden") {
      values[f.key] = one.slice(0, 200);
      return;
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

/** A field's show rule for the kit, on its outermost tag. */
const showAttr = (f: FormField) => (f.show ? ` data-show="${esc(JSON.stringify(f.show))}"` : "");

function fieldHtml(f: FormField, id: string): string {
  const html = fieldTag(f, id);
  const show = showAttr(f);
  // The outermost tag is a label or a fieldset: the rule goes on it.
  return show ? html.replace(/^<(label|fieldset)/, `<$1${show}`) : html;
}

function fieldTag(f: FormField, id: string): string {
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
    case "step":
      return "";
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
  const id = (i: number) => `f-${ctx.form.slice(0, 8)}-${i}`;
  const fields = spec.fields.some((f) => f.kind === "step")
    ? stepsHtml(spec.fields, id)
    : spec.fields.map((f, i) => fieldHtml(f, id(i))).join("\n");
  return `<form method="post" action="${esc(ctx.base)}/o/__form" data-wren-form data-form="${esc(ctx.form)}"${after}${booking} novalidate>
<input type="hidden" name="form" value="${esc(ctx.form)}">
${ctx.page ? `<input type="hidden" name="page" value="${esc(ctx.page)}">` : ""}
${fields}
<label class="trap" aria-hidden="true">Leave empty<input name="website" tabindex="-1" autocomplete="off"></label>
<button type="submit">${esc(spec.button)}</button>
<p class="sent" role="status" hidden></p>
</form>`;
}

/**
 * Fields split at each new step, one `div.step` a step, the step's words heading it. All show
 * without script; the kit shows one at a time with Back and Next.
 */
function stepsHtml(fields: FormField[], id: (i: number) => string): string {
  const out: string[] = [];
  let open = `<div class="step" data-step="1">`;
  let n = 1;
  fields.forEach((f, i) => {
    if (f.kind !== "step") {
      open += `\n${fieldHtml(f, id(i))}`;
      return;
    }
    out.push(`${open}\n</div>`);
    n++;
    open = `<div class="step" data-step="${n}">${f.label ? `\n<h3>${esc(f.label)}</h3>` : ""}`;
  });
  out.push(`${open}\n</div>`);
  return out.join("\n");
}

/** The form's heading and intro over the form. */
export const formIntro = (spec: FormSpec, h: "h1" | "h2") =>
  `<${h}>${esc(spec.title)}</${h}>\n${spec.intro ? `<p class="muted">${para(spec.intro)}</p>` : ""}`;
