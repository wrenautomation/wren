/**
 * The demo mask (R15): every demo response passes through here before it
 * leaves the server. It walks every string, whatever the route or field, so a
 * new view can't forget it. Surnames and middle names become an initial
 * ("Sarah K."), addresses keep one letter and the domain ("s•••@acme.com"),
 * LinkedIn profile links lose the name. Companies and other sources stay real.
 */

export interface ListName {
  first: string | null;
  last: string | null;
  full: string | null;
}

const EMAIL = /([\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]*@((?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]+)/gu;
const PROFILE = /(linkedin\.com\/(?:in|pub)\/)[^\s/?#"'<>]+/gi;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The words to hide: everything in a name but the first name. */
export function hiddenWords(names: readonly ListName[]): string[] {
  const words = new Set<string>();
  const split = (s: string | null) =>
    (s ?? "")
      .replace(/\([^)]*\)/g, " ")
      .split(/[\s,]+/)
      .map((w) => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ""))
      .filter((w) => w.length > 1);
  for (const n of names) {
    const first = split(n.first)[0]?.toLowerCase() ?? split(n.full)[0]?.toLowerCase();
    const full = split(n.full);
    for (const w of [...split(n.last), ...full.slice(1)])
      if (w.toLowerCase() !== first) words.add(w.toLowerCase());
  }
  return [...words].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function makeMask(names: readonly ListName[]): <T>(value: T) => T {
  const words = hiddenWords(names);
  const pattern = words.length
    ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`, "giu")
    : null;
  const text = (s: string): string => {
    let out = s.replace(EMAIL, (_, c: string, domain: string) => `${c}•••@${domain}`);
    out = out.replace(PROFILE, "$1•••");
    return pattern ? out.replace(pattern, (w) => `${w[0]?.toLocaleUpperCase()}.`) : out;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return text(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Date) return v;
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return <T>(value: T) => walk(value) as T;
}
