/**
 * The demo mask (R15): every demo response passes through here before it
 * leaves the server. It walks every string, keys included, whatever the route
 * or field, so a new view can't forget it. Surnames and middle names become an
 * initial ("Sarah K."), addresses keep one letter and the domain
 * ("s•••@acme.com"), LinkedIn profile links lose the name. Companies and other
 * sources stay real.
 *
 * Names match however the web writes them: any case, with or without accents,
 * either apostrophe, after a URL-encoded space, half of a hyphenated pair.
 */

export interface ListName {
  first: string | null;
  last: string | null;
  full: string | null;
}

const EMAIL = /([\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]*@((?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]+)/gu;
/** A profile link however it is written: slashes, `%2F`, or a search result's `›` breadcrumb. */
const PROFILE = /(linkedin\.com(?:\/|%2F|\s*›\s*)(?:in|pub)(?:\/|%2F|\s*›\s*))[^\s/?#"'<>%&›]+/gi;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const APOSTROPHES = /[’‘ʼ`´]/g;

/**
 * Lowercase, accents off, one apostrophe, the same UTF-16 length as `s`, so a
 * match in the folded text is the same range in the original.
 */
function fold(s: string): string {
  let out = "";
  for (const c of s) {
    const f = c.replace(APOSTROPHES, "'").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    out += f.length === c.length ? f : c;
  }
  return out;
}

/** A one-letter word is a name only in a script without initials (张, 王). */
const nameWord = (w: string) => w.length > 1 || (/\p{L}/u.test(w) && !/\p{Script=Latin}/u.test(w));

const words = (s: string | null) =>
  fold((s ?? "").normalize("NFC"))
    .split(/[\s,()]+/)
    .map((w) => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ""))
    .filter(nameWord);

/** "Doe, Jane": a single word before the comma is the surname. */
function firstNameOf(n: ListName): string | undefined {
  const first = words(n.first)[0];
  if (first) return first;
  const [before, after] = (n.full ?? "").split(",", 2);
  if (after !== undefined && words(before ?? "").length === 1) return words(after)[0];
  return words(n.full)[0];
}

/** The words to hide: everything in a name but the first name, and each half of a hyphenated one. */
export function hiddenWords(names: readonly ListName[]): string[] {
  const hidden = new Set<string>();
  for (const n of names) {
    const first = firstNameOf(n);
    for (const w of [...words(n.first), ...words(n.last), ...words(n.full)]) {
      if (w === first) continue;
      hidden.add(w);
      for (const part of w.split("-")) if (nameWord(part) && part !== first) hidden.add(part);
    }
  }
  return [...hidden].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function makeMask(names: readonly ListName[]): <T>(value: T) => T {
  const hidden = hiddenWords(names);
  // Not inside a word, but "%20Doe" counts as a word start: the digits belong to the escape.
  const pattern = hidden.length
    ? new RegExp(
        `(?:(?<=%[0-9a-f]{2})|(?<![\\p{L}\\p{N}]))(?:${hidden.map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`,
        "giu",
      )
    : null;
  const names_ = (s: string): string => {
    if (!pattern) return s;
    const folded = fold(s);
    let out = "";
    let at = 0;
    for (const m of folded.matchAll(pattern)) {
      const i = m.index ?? 0;
      const c = s[i] ?? "";
      out += s.slice(at, i) + (/\p{Script=Latin}/u.test(c) ? `${c.toLocaleUpperCase()}.` : "•");
      at = i + m[0].length;
    }
    return out + s.slice(at);
  };
  const text = (raw: string): string => {
    const s = raw.normalize("NFC");
    return names_(
      s
        .replace(EMAIL, (_, c: string, domain: string) => `${c}•••@${domain}`)
        .replace(PROFILE, "$1•••"),
    );
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return text(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Date) return v;
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [text(k), walk(x)]));
    return v;
  };
  return <T>(value: T) => walk(value) as T;
}
