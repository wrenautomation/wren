/**
 * What a study reads and what the model is shown. Pure: the run stores the
 * hits and pages, these decide which pages and which parts of them.
 */
import { type EvidencePage, foldText } from "../grounding.js";

export interface Hit {
  title: string;
  url: string;
  snippet: string | null;
}

/** Pages that read as a login wall or a video player, not text. */
const UNREADABLE = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
];

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

/** One page, one read: no fragment, no trailing slash. */
export const pageKey = (url: string): string => url.replace(/#.*$/, "").replace(/\/+$/, "");

/**
 * The pages to read for one angle: each list's best hit, then each list's
 * second, until `limit`. One list per query (and one for an answer engine's
 * sources), so no single query fills the angle. Social and video pages are
 * skipped; they don't read as text.
 */
export function pickReads(lists: readonly (readonly Hit[])[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let rank = 0; rank < longest && out.length < limit; rank++) {
    for (const list of lists) {
      const hit = list[rank];
      if (!hit) continue;
      const host = hostOf(hit.url);
      if (!host || UNREADABLE.some((h) => host === h || host.endsWith(`.${h}`))) continue;
      const key = pageKey(hit.url);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
      if (out.length >= limit) break;
    }
  }
  return out;
}

const STOP = new Set(
  "about after also been being between both could does doing each from have having here into more most much only other over same should some such than that their them then there these they this those through under very what when where which while with would your year years".split(
    " ",
  ),
);

/** The words worth matching in a question: four letters or more, not filler. */
export function terms(...texts: string[]): Set<string> {
  return new Set(
    texts
      .flatMap((t) => foldText(t).split(/[^\p{L}\d]+/u))
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  );
}

const CHUNK = 600;

/** Lines packed into chunks of about CHUNK characters, in page order. */
function chunks(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const line of text.split(/\n+/)) {
    const l = line.trim();
    if (!l) continue;
    if (cur && cur.length + l.length > CHUNK) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n${l}` : l;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * The parts of a page worth showing for these terms, in page order, within
 * `budget` characters. A chunk scores a point per term it has, and one more
 * when it has a number (a study wants figures). A short page is shown whole.
 */
export function passages(text: string, want: ReadonlySet<string>, budget: number): string {
  if (text.length <= budget) return text;
  const parts = chunks(text).map((c, i) => {
    const words = new Set(foldText(c).split(/[^\p{L}\d]+/u));
    let score = /\d/.test(c) ? 1 : 0;
    for (const t of want) if (words.has(t)) score++;
    return { i, c, score };
  });
  const picked: typeof parts = [];
  let used = 0;
  for (const p of [...parts].sort((a, b) => b.score - a.score || a.i - b.i)) {
    if (p.score === 0) break;
    if (used + p.c.length > budget) continue;
    picked.push(p);
    used += p.c.length + 2;
  }
  if (!picked.length) return text.slice(0, budget);
  return picked
    .sort((a, b) => a.i - b.i)
    .map((p) => p.c)
    .join("\n\n");
}

export const PAGE_CHARS = 5_000;
export const EVIDENCE_CHARS = 30_000;

/** The pages one angle's claims are drawn from: the best passages of each, within the budget. */
export function angleEvidence(
  pages: readonly EvidencePage[],
  want: ReadonlySet<string>,
): EvidencePage[] {
  const out: EvidencePage[] = [];
  let used = 0;
  for (const p of pages) {
    const room = Math.min(PAGE_CHARS, EVIDENCE_CHARS - used);
    if (room < 500) break;
    const text = passages(p.text, want, room);
    if (!text.trim()) continue;
    out.push({ url: p.url, text });
    used += text.length;
  }
  return out;
}
