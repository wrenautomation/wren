/**
 * Text to Kokoro's phonemes, after kokoro-js (Apache 2.0): numbers, money and titles in words,
 * then espeak-ng through phonemizer, with Kokoro's own fixes. Punctuation passes through as is.
 */
import { phonemize } from "phonemizer";

/** "1990" as "19 90", "3:05" as "3 oh 5". */
function year(m: string): string {
  if (m.includes(".")) return m;
  if (m.includes(":")) {
    const [h, min] = m.split(":").map(Number) as [number, number];
    return min === 0 ? `${h} o'clock` : min < 10 ? `${h} oh ${min}` : `${h} ${min}`;
  }
  const n = Number.parseInt(m.slice(0, 4), 10);
  if (n < 1100 || n % 1000 < 10) return m;
  const head = m.slice(0, 2);
  const tail = Number.parseInt(m.slice(2, 4), 10);
  const s = m.endsWith("s") ? "s" : "";
  if (n % 1000 >= 100 && n % 1000 <= 999) {
    if (tail === 0) return `${head} hundred${s}`;
    if (tail < 10) return `${head} oh ${tail}${s}`;
  }
  return `${head} ${tail}${s}`;
}

function money(m: string): string {
  const unit = m[0] === "$" ? "dollar" : "pound";
  const v = m.slice(1);
  if (Number.isNaN(Number(v))) return `${v} ${unit}s`;
  if (!v.includes(".")) return `${v} ${unit}${v === "1" ? "" : "s"}`;
  const [whole, part = ""] = v.split(".");
  const c = Number.parseInt(part.padEnd(2, "0"), 10);
  const small = m[0] === "$" ? (c === 1 ? "cent" : "cents") : c === 1 ? "penny" : "pence";
  return `${whole} ${unit}${whole === "1" ? "" : "s"} and ${c} ${small}`;
}

function point(m: string): string {
  const [a, b = ""] = m.split(".");
  return `${a} point ${b.split("").join(" ")}`;
}

export function normalize(t: string): string {
  return t
    .replace(/[‘’]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/\(/g, "«")
    .replace(/\)/g, "»")
    .replace(/[^\S \n]/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/\bD[Rr]\.(?= [A-Z])/g, "Doctor")
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, "Mister")
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, "Miss")
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, "Mrs")
    .replace(/\betc\.(?! [A-Z])/gi, "etc")
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, year)
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(
      /[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi,
      money,
    )
    .replace(/\d*\.\d+/g, point)
    .replace(/(?<=\d)-(?=\d)/g, " to ")
    .replace(/(?<=\d)S/g, " S")
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, "s")
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, "-"))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, "-")
    .trim();
}

const PUNCT = /(\s*[;:,.!?¡¿—…"«»“”(){}[\]]+\s*)+/g;

/** `us`: American English; else British. */
export async function phonemesOf(text: string, us: boolean): Promise<string> {
  const t = normalize(text);
  const parts: { punct: boolean; text: string }[] = [];
  let at = 0;
  for (const m of t.matchAll(PUNCT)) {
    if (at < m.index) parts.push({ punct: false, text: t.slice(at, m.index) });
    if (m[0]) parts.push({ punct: true, text: m[0] });
    at = m.index + m[0].length;
  }
  if (at < t.length) parts.push({ punct: false, text: t.slice(at) });
  const lang = us ? "en-us" : "en";
  const said = await Promise.all(
    parts.map(async (p) => (p.punct ? p.text : (await phonemize(p.text, lang)).join(" "))),
  );
  let out = said
    .join("")
    .replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ")
    .replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹəʊ")
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ")
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, "z");
  if (us) out = out.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di");
  return out.trim();
}
