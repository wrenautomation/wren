/**
 * Stored values are not sentence-ready.
 *
 * The SEC files legal entities and job titles in block capitals, stores AUM as a bare
 * integer of dollars, and lets an adviser file a first name that is only an initial.
 * This module makes them usable on one rule: it refuses rather than guesses. A value it
 * cannot make readable comes back null, which the renderer treats exactly as a missing fact.
 *
 * Casing is only rebuilt for a value filed all in one case (block capitals or all
 * lowercase); a mixed-case value keeps its casing. A firm is called what a person
 * would call it: no legal form, tagline or bracketed short name. Nothing is written
 * back — readability is derived at render time.
 */

// Split on runs of anything that is not part of a word, KEEPING the separators. Periods,
// apostrophes and hyphens stay inside a token. Unicode-aware: an accented letter is a letter.
const TOKENS = /([^\p{L}\p{N}_.'-]+)/u;
const VOWELS = new Set("AEIOUY");
// A run of dotted initials filed in place of a name: "B.J.", "A.M.J.".
const INITIALS = /^(?:[\p{L}\p{Nl}\p{No}]\.)+$/u;
const LETTER = /\p{L}/u;
const isAscii = (s: string) => [...s].every((c) => (c.codePointAt(0) as number) < 0x80);

const ENTITY: Readonly<Record<string, string>> = {
  LLC: "LLC",
  LLP: "LLP",
  LLLP: "LLLP",
  LP: "LP",
  PLLC: "PLLC",
  PLC: "PLC",
  PC: "PC",
  PA: "PA",
  LC: "LC",
  NA: "NA",
  SA: "SA",
  AG: "AG",
  NV: "NV",
  BV: "BV",
  INC: "Inc",
  CORP: "Corp",
  CO: "Co",
  LTD: "Ltd",
  PTE: "Pte",
  PTY: "Pty",
  GMBH: "GmbH",
};

// Three-letter English words common in firm names; measured 2026-09-11 over 7,066 names.
const SHORT_WORDS = new Set(
  (
    "RED OAK BAY KEY SUN NEW OLD BIG ONE TWO TEN ALL OUR TOP ARC ASH ELM FOX GEM ICE IVY OWL " +
    "SEA SKY WAY HUB JOY LAB MAP MID OIL TAX VIA ZEN ARK DAY END EYE FIT GAP INN PIN ROW RUN " +
    "SUM WIN AIM AIR BAR NET VAN MAN LAS LOS SAN DEL DES MAR LEO ION"
  ).split(" "),
);
// Lowercased when they fall inside a name, Title-cased when they open it.
const JOINERS = new Set("AND OF THE FOR TO AT IN ON OR A AN BY AS WITH".split(" "));
// Name particles: lowercase inside a surname, Title-cased when they open it.
const PARTICLES = new Set("VAN VON DER DEN DE DEL DELLA DI DA DOS DU LA LE".split(" "));
const SUFFIXES: Readonly<Record<string, string>> = {
  JR: "Jr.",
  SR: "Sr.",
  II: "II",
  III: "III",
  IV: "IV",
  V: "V",
  MD: "MD",
  PHD: "PhD",
  CFA: "CFA",
  CFP: "CFP",
  CPA: "CPA",
  ESQ: "Esq.",
};

const hasLetter = (s: string) => LETTER.test(s);
const letters = (s: string) => [...s].filter((c) => LETTER.test(c)).join("");
/** Python `str.capitalize()`: first character upper, the rest lower. */
const capitalize = (s: string) => {
  const [head = "", ...tail] = [...s];
  return head.toUpperCase() + tail.join("").toLowerCase();
};

/** A value worth rewriting: has letters and not one of them is lower. */
const isShouting = (s: string) => hasLetter(s) && s === s.toUpperCase();
/** Filed in one case, all capitals or all lowercase: its casing carries nothing. */
const oneCase = (s: string) => isShouting(s) || (hasLetter(s) && s === s.toLowerCase());

// A tagline after a spaced dash or bar: "Acme Staffing -- People First".
const TAGLINE = /\s+(?:-{1,2}|\u2013|\u2014|\|)\s+/u;
const BRACKETED = /\s*\([^)]*\)/g;
// One legal form at the end of a firm name, after a comma or a space. "Co." is left alone:
// in "Smith & Co." it is the name. Applied until none is left ("Pte. Ltd.", "Co., LLC").
const LEGAL_FORM = new RegExp(
  `(?:,\\s*|\\s+)(?:${[
    "l\\.?\\s?l\\.?\\s?c",
    "l\\.?\\s?l\\.?\\s?l?\\.?\\s?p",
    "p\\.?\\s?l\\.?\\s?l\\.?\\s?c",
    "p\\.?l\\.?c",
    "l\\.?p",
    "p\\.?c",
    "p\\.a",
    "inc(?:orporated)?",
    "an?\\s+corp(?:oration)?", // SBA files "LANE STAFFING INC A CORP"
    "corp(?:oration)?",
    "ltd",
    "limited(?:[\\s-]+liability(?:[\\s-]+(?:company|partnership))?)?",
    "pte",
    "pty",
    "gmbh",
  ].join("|")})\\.?$`,
  "i",
);

/** Title-case one word: O'BRIEN -> O'Brien, MID-AMERICAN -> Mid-American, MCGRAW -> McGraw. */
function titled(word: string): string {
  if (word.includes("-")) {
    return word
      .split("-")
      .map((part) => (part ? titled(part) : part))
      .join("-");
  }
  if (word.includes("'")) {
    const at = word.indexOf("'");
    const head = word.slice(0, at);
    const tail = word.slice(at + 1);
    // Only a short head is a prefix (O', D'). Otherwise the tail is a possessive.
    if (head.length >= 1 && head.length <= 2 && tail) return `${capitalize(head)}'${titled(tail)}`;
    return `${titled(head)}'${tail.toLowerCase()}`;
  }
  const ls = letters(word);
  if (ls.length >= 5 && ls.toUpperCase().startsWith("MC")) return `Mc${capitalize(word.slice(2))}`;
  return capitalize(word);
}

/** Company-and-title token rule: short all-caps tokens are initialisms unless listed as words. */
function acronymish(token: string, first: boolean): string {
  const bare = token.replace(/\.+$/, "");
  const key = bare.replaceAll(".", "").toUpperCase();
  const inner = token.replace(/^-+|-+$/g, "");
  if (inner.includes("-")) {
    return token
      .split("-")
      .map((part, i) => (part ? acronymish(part, first && i === 0) : part))
      .join("-");
  }
  // "CLASS A JOBS": a lone A in a firm name is a letter grade, not the article.
  if (key === "A") return "A";
  if (JOINERS.has(key)) return first ? titled(token) : token.toLowerCase();
  const entity = ENTITY[key];
  if (entity !== undefined && !bare.includes(".")) {
    return token.endsWith(".") ? `${entity}.` : entity;
  }
  if (entity !== undefined) return token.toUpperCase(); // filed with internal periods: L.P.
  if (!key) return token; // digits or bare punctuation
  if (!isAscii(key)) return titled(token); // an accented token is a word, never an initialism
  if (SHORT_WORDS.has(key)) return titled(token);
  if (key.length <= 3) return token.toUpperCase();
  if (key.length === 4 && ![...key].some((c) => VOWELS.has(c))) return token.toUpperCase();
  return titled(token);
}

/** Person-name token rule: ANN, LEE and KIM are names, never initialisms. */
function person(token: string, first: boolean): string {
  if (INITIALS.test(token)) return token.toUpperCase();
  const key = letters(token).toUpperCase();
  const suffix = SUFFIXES[key];
  if (suffix !== undefined) return suffix;
  if (PARTICLES.has(key) && !first) return token.toLowerCase();
  if (key.length === 1) return token.toUpperCase();
  return titled(token);
}

function rebuild(text: string, rule: (token: string, first: boolean) => string): string {
  let first = true;
  return text
    .split(TOKENS)
    .map((piece) => {
      if (!piece || !hasLetter(piece)) return piece;
      const out = rule(piece, first);
      first = false;
      return out;
    })
    .join("");
}

const asText = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value).trim();

/** A name fit to greet someone by, or null (a single letter refuses; "J.P." survives). */
export function readablePersonName(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  if (letters(text).length <= 1) return null;
  // "II" or "Jr." filed as the whole name: a parsing slip, not a name.
  const words = text.split(TOKENS).filter(hasLetter);
  if (words.every((w) => !INITIALS.test(w) && SUFFIXES[letters(w).toUpperCase()] !== undefined))
    return null;
  return oneCase(text) ? rebuild(text.toUpperCase(), person) : text;
}

/** A firm name fit to sit mid-sentence, or null. */
export function readableCompany(value: unknown): string | null {
  const filed = asText(value);
  if (!filed) return null;
  let text = filed;
  // "Career Personnel, Inc. -- the Professional Difference": the name is before the tagline.
  const head = text.split(TAGLINE)[0]?.trim() ?? "";
  if (hasLetter(head)) text = head;
  // "Free Market Talent Hub (FMTH)", "Unigestion (US) Ltd": the brackets are filing detail.
  if (text.includes("(")) {
    const bare = text
      .replace(BRACKETED, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (hasLetter(bare)) text = bare;
  }
  if (oneCase(text)) text = rebuild(text.toUpperCase(), acronymish);
  for (let cut = text.replace(LEGAL_FORM, ""); cut !== text; cut = text.replace(LEGAL_FORM, "")) {
    if (!hasLetter(cut)) break;
    text = cut.replace(/[\s,]+$/, "");
  }
  return text;
}

// Words that describe what a firm does, not who it is: a name that ends in them reads as
// pasted off a listing ("Grove Technical Resources"). A person says the word before them.
const DESCRIPTORS = new Set(
  (
    "staffing solutions solution group groups services service talent agency agencies " +
    "technologies technology technical partners partner associates healthcare professional " +
    "professionals medical resources resource global employment search searches hire hiring " +
    "recruiting recruitment recruiters recruiter consulting consultants consultancy personnel " +
    "workforce specialists specialist international systems management careers career " +
    "enterprises holdings company corporation network placement placements people advisors " +
    "executive executives staff nursing health connections"
  ).split(" "),
);
// Left alone, these name nobody ("Superior", "Premier"): the firm goes by its initials.
const PLAIN_WORDS = new Set(
  (
    "superior premier elite national american advanced strategic united first integrated " +
    "total prime pro smart top best quality select preferred reliable precision alliance " +
    "allied pinnacle summit apex peak priority express direct key core true north south " +
    "east west central pacific atlantic midwest southern northern eastern western general " +
    "complete creative innovative dynamic modern instant lead lucrative peer sharp " +
    "stability vital advance rapid swift trusted ideal optimal ultimate supreme dedicated " +
    "diverse elevated essential exceptional focused genuine honest proven quick ready " +
    "right secure simple solid strong success trust unique"
  ).split(" "),
);
// "Lucrative", "Overflowing": a describing word, whatever the list misses.
const isPlain = (word: string) =>
  PLAIN_WORDS.has(word) || (word.length >= 7 && /(?:ive|ous|ful|ing)$/.test(word));
const NAME_JOINERS = new Set(["&", "and", "of", "the", "+"]);

/**
 * A firm as a person would call it in a sentence: `readableCompany` less the words that
 * say what it does. "Grove Technical Resources" is Grove, "Briggs & Associates" is Briggs;
 * a name left with only a plain word ("Superior Resource Specialists") goes by its initials
 * (SRS). A name made only of such words, or too short to cut, stays whole.
 */
export function shortCompany(value: unknown): string | null {
  const full = readableCompany(value);
  if (!full) return null;
  const words = full
    .replace(/^the\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  const key = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}&+]/gu, "");
  let end = words.length;
  while (
    end > 1 &&
    (DESCRIPTORS.has(key(words[end - 1] ?? "")) || NAME_JOINERS.has(key(words[end - 1] ?? "")))
  )
    end--;
  const core = words.slice(0, end);
  const named = words.filter((w) => !NAME_JOINERS.has(key(w)));
  const plain = core.every((w) => isPlain(key(w)) || DESCRIPTORS.has(key(w)));
  if (plain || core.length === 0) {
    if (named.length < 3) return full;
    return named.map((w) => (w[0] ?? "").toUpperCase()).join("");
  }
  const short = core.join(" ");
  return letters(short).length >= 2 ? short : full;
}

/** A title longer than this refuses, however it is cased. */
export const TITLE_MAX_CHARS = 80;

/** A job title fit to sit mid-sentence, or null. */
export function readableTitle(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  const title = isShouting(text) ? rebuild(text, acronymish) : text;
  return [...title].length > TITLE_MAX_CHARS ? null : title;
}

/** Python `int(value)` semantics, or null: booleans, blanks and non-integers refuse. */
function toBigInt(value: unknown): bigint | null {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return Number.isFinite(value) ? BigInt(Math.trunc(value)) : null;
  if (typeof value === "string") {
    const text = value.trim().replaceAll("_", "");
    return /^[+-]?\d+$/.test(text) ? BigInt(text) : null;
  }
  return null;
}

const withCommas = (n: bigint) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** A count as a person would write it, or null: 23100 -> "23,100". Zero refuses. */
export function readableCount(value: unknown): string | null {
  const count = toBigInt(value);
  return count !== null && count > 0n ? withCommas(count) : null;
}

/** Whole dollars as a person would say them: 342000000 -> "$342M". Floored, never rounded up. */
export function readableMoney(value: unknown): string | null {
  const dollars = toBigInt(value);
  if (dollars === null || dollars <= 0n) return null;
  for (const [unit, suffix] of [
    [1_000_000_000_000n, "T"],
    [1_000_000_000n, "B"],
  ] as const) {
    if (dollars >= unit) {
      const scaled = (dollars * 10n) / unit;
      const whole = scaled / 10n;
      const tenth = scaled % 10n;
      return tenth !== 0n ? `$${whole}.${tenth}${suffix}` : `$${whole}${suffix}`;
    }
  }
  if (dollars >= 1_000_000n) return `$${dollars / 1_000_000n}M`;
  if (dollars >= 10_000n) return `$${dollars / 1_000n}K`;
  return `$${withCommas(dollars)}`;
}
